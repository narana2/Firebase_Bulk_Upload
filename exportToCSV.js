// Import required libraries
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Import Firebase service account credentials
const serviceAccount = require('./serviceAccountKey-BetterResources.json');

// Initialize Firebase Admin SDK
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = app.firestore();

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
  
  // Add all priority fields that exist in the data, even if they're not common
  priorityFields.forEach(field => {
    if (fieldCounts[field]) {
      orderedFields.push(field);
      // Remove from common fields to avoid duplicates
      const index = commonFields.indexOf(field);
      if (index > -1) {
        commonFields.splice(index, 1);
      }
    }
  });
  
  // Add remaining common fields
  orderedFields.push(...commonFields);
  
  console.log('\nFields to be included in CSV:');
  console.log(orderedFields.join(', '));
  
  return orderedFields;
}

// Function to escape CSV field value
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  let stringValue = String(value);
  
  // If the value contains a comma, quote, or newline, wrap it in quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    // Replace any quotes with double quotes (CSV standard for escaping quotes)
    stringValue = stringValue.replace(/"/g, '""');
    // Wrap in quotes
    stringValue = `"${stringValue}"`;
  }
  
  return stringValue;
}

// Function to export resources to CSV
function exportToCSV(resources, fields) {
  try {
    // Create CSV content
    let csvContent = '';
    
    // Add header row
    csvContent += fields.join(',') + '\n';
    
    // Add data rows
    resources.forEach(resource => {
      const row = fields.map(field => {
        const value = resource[field];
        
        // Format values appropriately for CSV
        if (value === undefined || value === null) {
          return '';
        } else if (typeof value === 'object') {
          return escapeCSV(JSON.stringify(value));
        } else {
          return escapeCSV(value);
        }
      });
      
      csvContent += row.join(',') + '\n';
    });
    
    // Create a filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `resources_export_${timestamp}.csv`;
    
    // Write to file
    fs.writeFileSync(filename, csvContent);
    
    console.log(`\nExport successful! CSV file created: ${filename}`);
    console.log(`File contains ${resources.length} resources with ${fields.length} fields each.`);
    
    // Provide instructions for importing to Google Sheets
    console.log('\nTo import this CSV to Google Sheets:');
    console.log('1. Go to https://sheets.new to create a new Google Sheet');
    console.log('2. Select File > Import > Upload > Select the CSV file');
    console.log('3. In the Import dialog, select:');
    console.log('   - Import location: Replace spreadsheet');
    console.log('   - Separator type: Comma');
    console.log('   - Click "Import data"');
    
    return filename;
  } catch (error) {
    console.error('Error exporting to CSV:', error);
    throw error;
  }
}

// Function to analyze resource types
function analyzeResourceTypes(resources) {
  console.log('\n\n=====================');
  console.log('Resource Type Analysis');
  console.log('=====================');
  
  // Count by Resource Type
  const resourceTypeCounts = {};
  let resourcesWithType = 0;
  let resourcesWithMultipleTypes = 0;
  
  resources.forEach(resource => {
    const resourceType = resource['Resource Type'];
    
    if (resourceType) {
      resourcesWithType++;
      
      if (typeof resourceType === 'string' && resourceType.includes(',')) {
        // Handle comma-separated types
        resourcesWithMultipleTypes++;
        const types = resourceType.split(',').map(t => t.trim());
        
        types.forEach(type => {
          resourceTypeCounts[type] = (resourceTypeCounts[type] || 0) + 1;
        });
      } else {
        // Handle single type
        resourceTypeCounts[resourceType] = (resourceTypeCounts[resourceType] || 0) + 1;
      }
    }
  });
  
  // Sort by count (descending)
  const sortedTypes = Object.entries(resourceTypeCounts)
    .sort((a, b) => b[1] - a[1]);
  
  console.log(`Resources with type: ${resourcesWithType}/${resources.length} (${((resourcesWithType / resources.length) * 100).toFixed(1)}%)`);
  console.log(`Resources with multiple types: ${resourcesWithMultipleTypes}`);
  console.log('\nResource counts by type:');
  
  sortedTypes.forEach(([type, count]) => {
    console.log(`${type}: ${count} resources (${((count / resources.length) * 100).toFixed(1)}%)`);
  });
  
  console.log(`\nTotal unique resource types: ${sortedTypes.length}`);
}

// Function to analyze states
function analyzeStates(resources) {
  console.log('\n\n=====================');
  console.log('State Analysis');
  console.log('=====================');
  
  // Count by state
  const stateCounts = {};
  
  resources.forEach(resource => {
    const state = resource.state;
    
    if (state) {
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    }
  });
  
  // Sort by count (descending)
  const sortedStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1]);
  
  console.log('\nResource counts by state:');
  
  sortedStates.forEach(([state, count]) => {
    console.log(`${state}: ${count} resources (${((count / resources.length) * 100).toFixed(1)}%)`);
  });
}

// Main function
async function exportResourcesAndAnalyze() {
  try {
    console.log('Starting export and analysis of resources...');
    
    // Get resources from Firebase
    const resources = await getResources();
    
    // Identify common fields
    const fields = identifyCommonFields(resources);
    
    // Export to CSV
    const csvFilename = exportToCSV(resources, fields);
    
    // Perform analysis
    analyzeResourceTypes(resources);
    analyzeStates(resources);
    
    console.log('\nExport and analysis completed successfully!');
    
    // Clean up Firebase connection
    await app.delete();
  } catch (error) {
    console.error('Export failed:', error);
  }
}

// Run the export and analysis
exportResourcesAndAnalyze(); 