// Import required libraries
const admin = require('firebase-admin');
const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');

// Import Firebase service account credentials
const serviceAccount = require('./serviceAccountKey-BetterResources.json');

// Initialize Firebase Admin SDK
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = app.firestore();

// Function to authenticate with Google Sheets API
async function getGoogleSheetsAuth() {
  try {
    // Check if credentials file exists
    if (!fs.existsSync('./google-sheets-credentials.json')) {
      console.error('Google Sheets credentials file not found: ./google-sheets-credentials.json');
      console.log('\nTo setup Google Sheets authentication:');
      console.log('1. Go to https://console.cloud.google.com/');
      console.log('2. Create a new project or select an existing one');
      console.log('3. Enable the Google Sheets API for your project');
      console.log('4. Create service account credentials');
      console.log('5. Download the JSON key file and save it as "google-sheets-credentials.json" in this directory');
      process.exit(1);
    }
    
    const credentials = require('./google-sheets-credentials.json');
    
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    
    await auth.authorize();
    return auth;
  } catch (error) {
    console.error('Error authenticating with Google Sheets:', error);
    process.exit(1);
  }
}

// Function to get spreadsheet data
async function getSpreadsheetData(spreadsheetId, sheetName = 'Sheet1') {
  try {
    const auth = await getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // If no sheet name is provided, get the first sheet name
    if (!sheetName) {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title'
      });
      
      if (response.data.sheets && response.data.sheets.length > 0) {
        sheetName = response.data.sheets[0].properties.title;
        console.log(`Using first sheet: "${sheetName}"`);
      } else {
        throw new Error('No sheets found in the spreadsheet');
      }
    }
    
    // Get sheet data
    console.log(`Reading data from sheet: "${sheetName}"`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName
    });
    
    const rows = response.data.values;
    
    if (!rows || rows.length === 0) {
      throw new Error('No data found in the spreadsheet');
    }
    
    // Extract headers from the first row
    const headers = rows[0];
    
    // Map the remaining rows to objects using the headers
    const resources = rows.slice(1).map(row => {
      const resource = {};
      
      for (let i = 0; i < headers.length; i++) {
        if (i < row.length && row[i] !== '') {
          resource[headers[i]] = row[i];
        }
      }
      
      return resource;
    });
    
    console.log(`Read ${resources.length} resources from Google Sheet`);
    return resources;
  } catch (error) {
    console.error('Error fetching spreadsheet data:', error);
    throw error;
  }
}

// Function to upload resources to Firebase
async function uploadToFirebase(resources, collectionName) {
  console.log(`Uploading ${resources.length} resources to collection: ${collectionName}`);
  
  // Create a batch for efficient uploading
  let batch = db.batch();
  let operationCount = 0;
  const batchLimit = 500; // Firestore batch limit is 500 operations
  
  // Keep track of progress and successful uploads
  let successCount = 0;
  let failureCount = 0;
  let updatedCount = 0;
  let newCount = 0;
  
  // Keep track of document IDs to detect duplicates within the sheet data
  const processedIds = new Set();
  const duplicateIds = [];
  
  try {
    // First, check which resources already exist in the collection
    console.log(`Checking for existing documents in collection: ${collectionName}`);
    const existingDocsSnapshot = await db.collection(collectionName).get();
    const existingDocs = new Set();
    
    existingDocsSnapshot.forEach(doc => {
      existingDocs.add(doc.id);
    });
    
    console.log(`Found ${existingDocs.size} existing documents in the collection`);
    
    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      
      // Extract the document ID if it exists, otherwise create a new one
      let docId = resource.id;
      
      // Skip resources without an ID
      if (!docId) {
        console.warn(`Warning: Resource at index ${i} has no ID and will be skipped.`);
        failureCount++;
        continue;
      }
      
      // Check for duplicates within the sheet data
      if (processedIds.has(docId)) {
        console.warn(`Warning: Duplicate ID found in spreadsheet data: ${docId}. Only the first occurrence will be used.`);
        duplicateIds.push(docId);
        continue;
      }
      
      // Mark this ID as processed
      processedIds.add(docId);
      
      // Remove id field to avoid duplication (it's already the document ID)
      const resourceData = {...resource};
      if (resourceData.id) {
        delete resourceData.id;
      }
      
      // Get document reference
      const docRef = db.collection(collectionName).doc(docId);
      
      // Check if this document already exists in the collection
      const docExists = existingDocs.has(docId);
      
      // Add set operation to batch
      batch.set(docRef, resourceData);
      operationCount++;
      
      // Track if this is an update or new document
      if (docExists) {
        updatedCount++;
      } else {
        newCount++;
      }
      
      // If we've reached the batch limit or the end of the resources, commit the batch
      if (operationCount === batchLimit || i === resources.length - 1) {
        await batch.commit();
        console.log(`Batch committed: ${operationCount} operations`);
        
        // Reset for next batch
        batch = db.batch();
        operationCount = 0;
      }
      
      // Update success count
      successCount++;
      
      // Log progress
      if ((i + 1) % 50 === 0 || i === resources.length - 1) {
        console.log(`Progress: ${i + 1}/${resources.length} resources processed`);
      }
    }
    
    console.log(`\nUpload completed: ${successCount} resources processed successfully`);
    console.log(`- ${newCount} new resources created`);
    console.log(`- ${updatedCount} existing resources updated`);
    
    if (duplicateIds.length > 0) {
      console.log(`- ${duplicateIds.length} duplicate IDs found in the spreadsheet data (only first occurrence used)`);
      if (duplicateIds.length <= 10) {
        console.log(`  Duplicate IDs: ${duplicateIds.join(', ')}`);
      } else {
        console.log(`  First 10 duplicate IDs: ${duplicateIds.slice(0, 10).join(', ')}...`);
      }
    }
    
    if (failureCount > 0) {
      console.log(`- ${failureCount} resources failed to upload`);
    }
    
    return { successCount, failureCount, newCount, updatedCount, duplicateIds };
  } catch (error) {
    console.error('Error in batch upload:', error);
    // Update failure count with remaining items
    failureCount += (resources.length - successCount);
    return { successCount, failureCount, newCount, updatedCount, duplicateIds, error };
  }
}

// Helper function to get user input
async function getUserInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

// Function to read spreadsheet ID from file or environment
function getSpreadsheetId() {
  // Check environment variable first
  if (process.env.SPREADSHEET_ID) {
    return process.env.SPREADSHEET_ID;
  }
  
  // Check for spreadsheet-id.txt file
  try {
    if (fs.existsSync('./spreadsheet-id.txt')) {
      return fs.readFileSync('./spreadsheet-id.txt', 'utf8').trim();
    }
  } catch (err) {
    // If there's an error reading the file, continue to prompt the user
  }
  
  return null;
}

// Main function
async function importFromGoogleSheetToFirebase() {
  try {
    console.log('Starting Google Sheet import to Firebase...');
    
    // Get spreadsheet ID from environment, file, or user input
    let spreadsheetId = getSpreadsheetId();
    
    if (!spreadsheetId) {
      spreadsheetId = await getUserInput(
        'Enter the Google Spreadsheet ID (from the URL "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/"): '
      );
      
      // Save the ID for future use
      fs.writeFileSync('./spreadsheet-id.txt', spreadsheetId);
    }
    
    console.log(`Using spreadsheet ID: ${spreadsheetId}`);
    
    // Get sheet name (optional)
    const sheetName = await getUserInput(
      'Enter the sheet name (press Enter to use the first sheet): '
    );
    
    // Read spreadsheet data
    const resources = await getSpreadsheetData(spreadsheetId, sheetName || null);
    
    // Target collection name
    const defaultCollection = 'testResources';
    const collectionName = await getUserInput(
      `Enter the target Firestore collection name (press Enter for "${defaultCollection}"): `
    );
    
    // Use default collection if none provided
    const targetCollection = collectionName || defaultCollection;
    
    // Ask for confirmation before uploading
    console.log(`\nReady to upload ${resources.length} resources to collection "${targetCollection}".`);
    const confirmation = await getUserInput('Type "yes" to proceed, or anything else to cancel: ');
    
    if (confirmation.toLowerCase() !== 'yes') {
      console.log('Operation cancelled by user.');
      await app.delete();
      return;
    }
    
    // Upload to Firebase
    await uploadToFirebase(resources, targetCollection);
    
    console.log(`\nImport to collection "${targetCollection}" completed successfully!`);
    
    // Clean up Firebase connection
    await app.delete();
    
  } catch (error) {
    console.error('Import failed:', error);
    try {
      await app.delete();
    } catch (err) {
      // Ignore cleanup errors
    }
  }
}

// Run the import
importFromGoogleSheetToFirebase(); 