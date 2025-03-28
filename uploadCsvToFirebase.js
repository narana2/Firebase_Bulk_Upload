// Import required libraries
const admin = require('firebase-admin');
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

// Function to parse CSV line with proper handling of quoted fields
function parseCSVLine(line) {
  const result = [];
  let insideQuotes = false;
  let currentField = '';
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      // Handle escaped quotes (two consecutive quotes inside a quoted field)
      if (insideQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++; // Skip the next quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // Field delimiter - add field to result and reset
      result.push(currentField);
      currentField = '';
    } else {
      // Add character to current field
      currentField += char;
    }
  }
  
  // Add the last field
  result.push(currentField);
  
  return result;
}

// Function to read CSV file and convert to array of objects
async function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`CSV file not found: ${filePath}`);
      }
      
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      const resources = [];
      let headers = null;
      let lineNumber = 0;
      
      rl.on('line', (line) => {
        lineNumber++;
        
        // Skip empty lines
        if (!line.trim()) return;
        
        // Parse the CSV line
        const fields = parseCSVLine(line);
        
        if (!headers) {
          // First line is headers
          headers = fields;
        } else {
          // Create an object for each data row
          const resource = {};
          
          // Assign each field to its corresponding header
          for (let i = 0; i < headers.length; i++) {
            // Skip empty fields
            if (fields[i] !== '') {
              resource[headers[i]] = fields[i];
            }
          }
          
          resources.push(resource);
        }
      });
      
      rl.on('close', () => {
        console.log(`Read ${resources.length} resources from CSV file`);
        resolve(resources);
      });
      
      rl.on('error', (error) => {
        reject(error);
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

// Function to generate a slug from a string
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')        // Replace spaces with -
    .replace(/[^\w\-]+/g, '')    // Remove all non-word chars
    .replace(/\-\-+/g, '-')      // Replace multiple - with single -
    .replace(/^-+/, '')          // Trim - from start of text
    .replace(/-+$/, '')          // Trim - from end of text
    .substring(0, 30);           // Limit length
}

// Function to generate a unique ID for a resource
function generateResourceId(resource, index) {
  // Try to use title if available
  if (resource.title) {
    // Generate slug from title
    const baseSlug = slugify(resource.title);
    
    // Add resource type if available
    if (resource['Resource Type']) {
      return `${baseSlug}-${slugify(resource['Resource Type'])}`;
    }
    
    return baseSlug;
  }
  
  // If no title, use resource type + state if available
  if (resource['Resource Type'] && resource.state) {
    return `${slugify(resource['Resource Type'])}-${resource.state.toLowerCase()}-${Date.now().toString().slice(-6)}`;
  }
  
  // Last resort: generic ID with timestamp
  return `generated-resource-${index}-${Date.now().toString().slice(-6)}`;
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
  let generatedIdCount = 0;
  
  // Keep track of document IDs to detect duplicates within the CSV
  const processedIds = new Set();
  const duplicateIds = [];
  const generatedIds = [];
  
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
      
      // Extract the document ID if it exists, otherwise generate one
      let docId = resource.id;
      let isGeneratedId = false;
      
      if (!docId) {
        // Generate an ID
        docId = generateResourceId(resource, i);
        isGeneratedId = true;
        generatedIdCount++;
        generatedIds.push({ index: i, id: docId, title: resource.title || 'No title' });
        
        console.log(`Generated ID "${docId}" for resource at index ${i}: ${resource.title || 'No title'}`);
        
        // Add the generated ID to the resource for reference
        resource.id = docId;
      }
      
      // Check for duplicates within the CSV data
      if (processedIds.has(docId)) {
        // For generated IDs, make them unique by adding a suffix
        if (isGeneratedId) {
          const originalId = docId;
          docId = `${docId}-${Date.now().toString().slice(-6)}`;
          console.log(`Modified duplicate generated ID "${originalId}" to "${docId}"`);
        } else {
          console.warn(`Warning: Duplicate ID found in CSV data: ${docId}. Only the first occurrence will be used.`);
          duplicateIds.push(docId);
          continue;
        }
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
    console.log(`- ${generatedIdCount} resources had IDs automatically generated`);
    
    if (generatedIds.length > 0) {
      console.log(`\nGenerated IDs summary:`);
      generatedIds.forEach(item => {
        console.log(`- Resource at index ${item.index}: "${item.title}" → ID: "${item.id}"`);
      });
    }
    
    if (duplicateIds.length > 0) {
      console.log(`\n${duplicateIds.length} duplicate IDs found in the CSV data (only first occurrence used)`);
      if (duplicateIds.length <= 10) {
        console.log(`  Duplicate IDs: ${duplicateIds.join(', ')}`);
      } else {
        console.log(`  First 10 duplicate IDs: ${duplicateIds.slice(0, 10).join(', ')}...`);
      }
    }
    
    if (failureCount > 0) {
      console.log(`- ${failureCount} resources failed to upload`);
    }
    
    return { successCount, failureCount, newCount, updatedCount, duplicateIds, generatedIds };
  } catch (error) {
    console.error('Error in batch upload:', error);
    // Update failure count with remaining items
    failureCount += (resources.length - successCount);
    return { successCount, failureCount, newCount, updatedCount, duplicateIds, generatedIds, error };
  }
}

// Main function
async function uploadCsvToFirebase() {
  try {
    console.log('Starting CSV import to Firebase...');
    
    // Use the specific CSV file instead of finding the most recent one
    const csvFile = 'Firebase Resources - resources.csv';
    console.log(`Using CSV file: ${csvFile}`);
    
    // Read CSV file
    const resources = await readCSV(csvFile);
    
    // Target collection name
    const collectionName = 'testResources';
    
    // Ask for confirmation before uploading
    console.log(`\nReady to upload ${resources.length} resources to collection "${collectionName}".`);
    console.log('Press Ctrl+C to cancel or wait 5 seconds to proceed...');
    
    // Wait 5 seconds before proceeding (allows time to cancel)
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Upload to Firebase
    await uploadToFirebase(resources, collectionName);
    
    console.log(`\nImport to collection "${collectionName}" completed successfully!`);
    
    // Clean up Firebase connection
    await app.delete();
    
  } catch (error) {
    console.error('Import failed:', error);
  }
}

// Run the upload
uploadCsvToFirebase(); 