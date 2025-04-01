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
      
      // Define expected headers and their mappings
      const headerMappings = {
        0: 'id',
        1: 'title',
        2: 'Resource Type',
        3: 'state',
        4: 'website',
        5: 'phone number',
        6: 'email'
      };
      
      rl.on('line', (line) => {
        lineNumber++;
        
        // Skip empty lines
        if (!line.trim()) return;
        
        // Parse the CSV line
        const fields = parseCSVLine(line);
        
        if (!headers) {
          // Use predefined headers mapping instead of reading from the first line
          headers = [];
          for (let i = 0; i < fields.length; i++) {
            headers.push(headerMappings[i] || `field${i}`);
          }
          
          console.log(`Using headers: ${headers.join(', ')}`);
        } else {
          // Create an object for each data row
          const resource = {};
          
          // Assign each field to its corresponding header
          for (let i = 0; i < headers.length; i++) {
            // Skip empty fields and ensure no empty keys are used
            if (fields[i] !== '' && headers[i] !== '') {
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

// Function to compare two objects and check if they have different values
function hasResourceChanged(existingData, newData) {
  // If existing data is null/undefined, consider it as changed
  if (!existingData) return true;
  
  // Compare each field in newData with existingData
  for (const key in newData) {
    // Skip comparing id field as it's the document ID
    if (key === 'id') continue;
    
    // If field exists in newData but not in existingData, or has different value
    if (!(key in existingData) || existingData[key] !== newData[key]) {
      return true;
    }
  }
  
  // Check if there are fields in existingData that are not in newData
  for (const key in existingData) {
    if (!(key in newData)) {
      return true;
    }
  }
  
  return false;
}

// Function to upload resources to Firebase
async function uploadToFirebase(resources, collectionName, isDryRun = false) {
  console.log(`Uploading ${resources.length} resources to collection: ${collectionName}${isDryRun ? ' (DRY RUN)' : ''}`);
  
  // Create a batch for efficient uploading
  let batch = db.batch();
  let operationCount = 0;
  const batchLimit = 500; // Firestore batch limit is 500 operations
  
  // Keep track of progress and successful uploads
  let successCount = 0;
  let failureCount = 0;
  let updatedCount = 0;
  let newCount = 0;
  let unchangedCount = 0;
  let generatedIdCount = 0;
  let skippedCount = 0;
  
  // Keep track of document IDs to detect duplicates within the CSV
  const processedIds = new Set();
  const duplicateIds = [];
  const generatedIds = [];
  const skippedResources = [];
  
  try {
    // First, check which resources already exist in the collection
    console.log(`Checking for existing documents in collection: ${collectionName}`);
    const existingDocsSnapshot = await db.collection(collectionName).get();
    const existingDocs = new Map(); // Use Map to store both ID and data
    
    existingDocsSnapshot.forEach(doc => {
      existingDocs.set(doc.id, doc.data());
    });
    
    console.log(`Found ${existingDocs.size} existing documents in the collection`);
    
    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      
      // Skip if no resource data or empty object
      if (!resource || Object.keys(resource).length === 0) {
        console.log(`Skipping empty resource at index ${i}`);
        skippedCount++;
        skippedResources.push({ index: i, reason: 'Empty resource' });
        continue;
      }
      
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
          skippedCount++;
          skippedResources.push({ index: i, id: docId, reason: 'Duplicate ID' });
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
      
      // Additional validation: skip if empty field names exist
      let hasEmptyFieldName = false;
      for (const key in resourceData) {
        if (!key || key.trim() === '') {
          hasEmptyFieldName = true;
          console.warn(`Warning: Empty field name found in resource at index ${i}. Skipping this resource.`);
          break;
        }
      }
      
      if (hasEmptyFieldName) {
        skippedCount++;
        skippedResources.push({ index: i, id: docId, reason: 'Empty field name' });
        continue;
      }
      
      // Get document reference
      const docRef = db.collection(collectionName).doc(docId);
      
      // Check if this document already exists in the collection
      const existingData = existingDocs.get(docId);
      const docExists = existingData !== undefined;
      
      // Check if the resource has changed
      const hasChanged = !docExists || hasResourceChanged(existingData, resourceData);
      
      // In dry run mode, just log what would happen
      if (isDryRun) {
        if (!docExists) {
          console.log(`[DRY RUN] Would create new document ${docId}:`);
        } else if (hasChanged) {
          console.log(`[DRY RUN] Would update changed document ${docId}:`);
        } else {
          console.log(`[DRY RUN] Would skip unchanged document ${docId}`);
        }
        if (hasChanged) {
          console.log('  Data:', JSON.stringify(resourceData, null, 2));
        }
      } else if (hasChanged) {
        // Add set operation to batch only if the resource has changed
        batch.set(docRef, resourceData);
        operationCount++;
        
        // If we've reached the batch limit or the end of the resources, commit the batch
        if (operationCount === batchLimit || i === resources.length - 1) {
          await batch.commit();
          console.log(`Batch committed: ${operationCount} operations`);
          
          // Reset for next batch
          batch = db.batch();
          operationCount = 0;
        }
      }
      
      // Track if this is an update, new document, or unchanged
      if (docExists) {
        if (hasChanged) {
          updatedCount++;
        } else {
          unchangedCount++;
        }
      } else {
        newCount++;
      }
      
      // Update success count
      successCount++;
      
      // Log progress
      if ((i + 1) % 50 === 0 || i === resources.length - 1) {
        console.log(`Progress: ${i + 1}/${resources.length} resources processed`);
      }
    }
    
    console.log(`\nUpload completed: ${successCount} resources processed successfully`);
    console.log(`- ${newCount} new resources ${isDryRun ? 'would be created' : 'created'}`);
    console.log(`- ${updatedCount} existing resources ${isDryRun ? 'would be updated' : 'updated'}`);
    console.log(`- ${unchangedCount} existing resources ${isDryRun ? 'would be skipped' : 'skipped'} (no changes)`);
    console.log(`- ${generatedIdCount} resources had IDs automatically generated`);
    console.log(`- ${skippedCount} resources skipped due to errors`);
    
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
    
    if (skippedResources.length > 0) {
      console.log(`\n${skippedResources.length} resources skipped:`);
      if (skippedResources.length <= 10) {
        skippedResources.forEach(item => {
          console.log(`- Index ${item.index}${item.id ? `, ID: ${item.id}` : ''}, Reason: ${item.reason}`);
        });
      } else {
        console.log(`  First 10 skipped resources:`);
        skippedResources.slice(0, 10).forEach(item => {
          console.log(`- Index ${item.index}${item.id ? `, ID: ${item.id}` : ''}, Reason: ${item.reason}`);
        });
      }
    }
    
    if (failureCount > 0) {
      console.log(`- ${failureCount} resources failed to upload`);
    }
    
    return { successCount, failureCount, newCount, updatedCount, unchangedCount, duplicateIds, generatedIds, skippedResources };
  } catch (error) {
    console.error('Error in batch upload:', error);
    // Update failure count with remaining items
    failureCount += (resources.length - successCount);
    return { successCount, failureCount, newCount, updatedCount, unchangedCount, duplicateIds, generatedIds, skippedResources, error };
  }
}

// Main function
async function uploadCsvToFirebase() {
  try {
    console.log('Starting CSV import to Firebase...');
    
    // Check for --dry-run flag
    const isDryRun = process.argv.includes('--dry-run');
    if (isDryRun) {
      console.log('DRY RUN MODE: No changes will be made to Firebase');
    }
    
    // Use the specific CSV file instead of finding the most recent one
    const csvFile = 'Firebase Resources - resources.csv';
    console.log(`Using CSV file: ${csvFile}`);
    
    // Read CSV file
    const resources = await readCSV(csvFile);
    
    // Target collection name
    const collectionName = 'resourcesApp';
    
    // Ask for confirmation before uploading
    console.log(`\nReady to ${isDryRun ? 'simulate upload of' : 'upload'} ${resources.length} resources to collection "${collectionName}".`);
    console.log('Press Ctrl+C to cancel or wait 5 seconds to proceed...');
    
    // Wait 5 seconds before proceeding (allows time to cancel)
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Upload to Firebase
    await uploadToFirebase(resources, collectionName, isDryRun);
    
    console.log(`\nImport to collection "${collectionName}" ${isDryRun ? 'simulation' : ''} completed successfully!`);
    
    // Clean up Firebase connection
    await app.delete();
    
  } catch (error) {
    console.error('Import failed:', error);
  }
}

// Run the upload
uploadCsvToFirebase(); 