// Import required libraries
const admin = require('firebase-admin');
const { google } = require('googleapis');
const fs = require('fs');

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
  // This function assumes you have a credentials file for Google Sheets API
  // You'll need to create this file by setting up a project in Google Cloud Console
  try {
    const credentials = require('./google-sheets-credentials.json');
    
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    await auth.authorize();
    return auth;
  } catch (error) {
    console.error('Error authenticating with Google Sheets:', error);
    console.log('\nTo setup Google Sheets authentication:');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Create a new project or select an existing one');
    console.log('3. Enable the Google Sheets API for your project');
    console.log('4. Create service account credentials');
    console.log('5. Download the JSON key file and save it as "google-sheets-credentials.json" in this directory');
    process.exit(1);
  }
}

// Function to get all resources from Firebase
async function getResources() {
  try {
    const snapshot = await db.collection('resourcesApp').get();
    console.log(`Retrieved ${snapshot.size} resources from Firebase`);
    
    // Convert to array of objects
    const resources = [];
    snapshot.forEach(doc => {
      // Get document data and add document ID
      const data = doc.data();
      data.id = doc.id;
      resources.push(data);
    });
    
    return resources;
  } catch (error) {
    console.error('Error fetching resources from Firebase:', error);
    throw error;
  }
}

// Function to identify common fields across all resources
function identifyCommonFields(resources) {
  // Count field occurrences
  const fieldCounts = {};
  
  resources.forEach(resource => {
    Object.keys(resource).forEach(field => {
      fieldCounts[field] = (fieldCounts[field] || 0) + 1;
    });
  });
  
  // Sort fields by frequency (descending)
  const sortedFields = Object.entries(fieldCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => ({
      field,
      count,
      percentage: ((count / resources.length) * 100).toFixed(1)
    }));
  
  console.log('\nField occurrence in resources:');
  sortedFields.forEach(field => {
    console.log(`${field.field}: ${field.count}/${resources.length} (${field.percentage}%)`);
  });
  
  // Identify common fields (present in >50% of resources)
  const commonFields = sortedFields
    .filter(field => (field.count / resources.length) > 0.5)
    .map(field => field.field);
  
  // Always include id field
  if (!commonFields.includes('id')) {
    commonFields.unshift('id');
  }
  
  // Prioritize important fields by moving them to the front
  const priorityFields = ['id', 'title', 'Resource Type', 'state', 'website', 'phone number', 'email'];
  
  // Reorder fields to put priority fields first
  const orderedFields = [];
  
  // Add priority fields that exist in common fields
  priorityFields.forEach(field => {
    if (commonFields.includes(field)) {
      orderedFields.push(field);
      // Remove to avoid duplicates
      const index = commonFields.indexOf(field);
      if (index > -1) {
        commonFields.splice(index, 1);
      }
    }
  });
  
  // Add remaining common fields
  orderedFields.push(...commonFields);
  
  console.log('\nFields to be included in spreadsheet:');
  console.log(orderedFields.join(', '));
  
  return orderedFields;
}

// Function to create or update Google Spreadsheet
async function exportToGoogleSheets(resources, fields) {
  try {
    const auth = await getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Spreadsheet configuration
    const spreadsheetId = process.env.SPREADSHEET_ID; // Set this if you want to update an existing spreadsheet
    let operation;
    
    if (!spreadsheetId) {
      // Create a new spreadsheet
      console.log('Creating new Google Spreadsheet...');
      
      const createResponse = await sheets.spreadsheets.create({
        resource: {
          properties: {
            title: 'Resources Database Export',
          },
          sheets: [
            {
              properties: {
                title: 'Resources',
              },
            },
          ],
        },
      });
      
      const newSpreadsheetId = createResponse.data.spreadsheetId;
      console.log(`Created new spreadsheet with ID: ${newSpreadsheetId}`);
      
      // Save the spreadsheet ID to a file for future use
      fs.writeFileSync('spreadsheet-id.txt', newSpreadsheetId);
      
      operation = {
        spreadsheetId: newSpreadsheetId,
        range: 'Resources!A1',
      };
    } else {
      // Update existing spreadsheet
      console.log(`Updating existing spreadsheet with ID: ${spreadsheetId}`);
      operation = {
        spreadsheetId,
        range: 'Resources!A1',
      };
    }
    
    // Prepare spreadsheet data
    const spreadsheetData = [];
    
    // Add headers row
    spreadsheetData.push(fields);
    
    // Add resource data rows
    resources.forEach(resource => {
      const row = fields.map(field => {
        const value = resource[field];
        
        // Format values appropriately for the spreadsheet
        if (value === undefined || value === null) {
          return '';
        } else if (typeof value === 'object') {
          return JSON.stringify(value);
        } else {
          return value.toString();
        }
      });
      
      spreadsheetData.push(row);
    });
    
    // Update spreadsheet with data
    const updateResponse = await sheets.spreadsheets.values.update({
      ...operation,
      valueInputOption: 'RAW',
      resource: {
        values: spreadsheetData,
      },
    });
    
    console.log(`Spreadsheet updated successfully. Updated ${updateResponse.data.updatedCells} cells.`);
    
    // Format header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: operation.spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.8,
                    green: 0.8,
                    blue: 0.8,
                  },
                  horizontalAlignment: 'CENTER',
                  textFormat: {
                    bold: true,
                  },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: fields.length,
              },
            },
          },
        ],
      },
    });
    
    console.log('\nSpreadsheet formatting applied.');
    console.log(`\nAccess your spreadsheet at: https://docs.google.com/spreadsheets/d/${operation.spreadsheetId}`);
    
    return operation.spreadsheetId;
  } catch (error) {
    console.error('Error exporting to Google Sheets:', error);
    throw error;
  }
}

// Main function
async function exportResourcesToGoogleSheets() {
  try {
    console.log('Starting export of resources to Google Sheets...');
    
    // Get resources from Firebase
    const resources = await getResources();
    
    // Identify common fields
    const fields = identifyCommonFields(resources);
    
    // Export to Google Sheets
    await exportToGoogleSheets(resources, fields);
    
    console.log('\nExport completed successfully!');
    
    // Clean up Firebase connection
    await app.delete();
  } catch (error) {
    console.error('Export failed:', error);
  }
}

// Run the export
exportResourcesToGoogleSheets(); 