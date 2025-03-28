// Import required modules
const admin = require("firebase-admin");
const axios = require("axios");
const fs = require("fs");

// Import service account credentials
const serviceAccount = require("./serviceAccountKey-BetterResources.json");

// Initialize Firebase Admin if not already initialized
let app;
try {
  app = admin.app();
} catch (e) {
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Get Firestore reference
const db = app.firestore();

// Check if --dry-run flag is present
const isDryRun = process.argv.includes('--dry-run');
const inputFile = "broken_links_report.json";

// Function to fix common URL issues
function fixUrl(url) {
  if (!url) return null;
  
  // Trim spaces
  let fixedUrl = url.trim();
  
  // Fix missing protocol
  if (!fixedUrl.startsWith('http://') && !fixedUrl.startsWith('https://')) {
    // Add https:// prefix
    fixedUrl = 'https://' + fixedUrl;
  }
  
  // Fix common typos
  fixedUrl = fixedUrl.replace('www.capp.og', 'www.capp.org');
  
  // Remove trailing spaces in URL parts
  fixedUrl = fixedUrl.replace(/\s+/g, '');
  
  // Try to create a URL object to validate basic format
  try {
    new URL(fixedUrl);
    return fixedUrl;
  } catch (e) {
    console.log(`Could not fix URL format for: ${url}`);
    return null;
  }
}

// Function to test a URL and see if it works
async function testUrl(url) {
  if (!url) return false;
  
  try {
    const response = await axios({
      method: 'head',
      url: url,
      timeout: 10000,
      validateStatus: () => true
    });
    
    return response.status >= 200 && response.status < 400;
  } catch (error) {
    return false;
  }
}

async function fixInvalidUrls() {
  try {
    console.log("Starting to fix invalid URLs...");
    
    // Load the broken links report
    let brokenLinksData;
    try {
      brokenLinksData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    } catch (error) {
      console.error(`Could not read the broken links report file. Please run validateResourceLinks.js first.`);
      process.exit(1);
    }
    
    const brokenLinks = brokenLinksData.brokenLinks;
    console.log(`Found ${brokenLinks.length} broken links to fix.`);
    
    // Filter for links with "Invalid URL" error
    const invalidUrlLinks = brokenLinks.filter(link => 
      link.error === "Invalid URL" || 
      link.error.includes("Invalid URL") ||
      link.error.includes("Parse Error")
    );
    
    console.log(`Found ${invalidUrlLinks.length} invalid URL format issues to attempt to fix.`);
    
    // Create a batch for updates
    const batch = db.batch();
    let fixedCount = 0;
    let failedCount = 0;
    
    // Process each invalid URL
    for (const link of invalidUrlLinks) {
      console.log(`\nAttempting to fix: ${link.url} (ID: ${link.id})`);
      
      // Try to fix the URL
      const fixedUrl = fixUrl(link.url);
      
      if (fixedUrl) {
        console.log(`  Fixed URL format: ${fixedUrl}`);
        
        // Test if the fixed URL works
        const isWorking = await testUrl(fixedUrl);
        console.log(`  URL validation: ${isWorking ? 'Success ✓' : 'Still not working ✗'}`);
        
        // Get the document reference
        const docRef = db.collection("resourcesApp").doc(link.id);
        
        // Determine which field to update (link, url, or website)
        const docSnapshot = await docRef.get();
        if (!docSnapshot.exists) {
          console.log(`  Resource with ID ${link.id} no longer exists.`);
          failedCount++;
          continue;
        }
        
        const data = docSnapshot.data();
        let fieldToUpdate = null;
        
        if (data.link) fieldToUpdate = 'link';
        else if (data.url) fieldToUpdate = 'url';
        else if (data.website) fieldToUpdate = 'website';
        
        if (!fieldToUpdate) {
          console.log(`  Could not determine which field to update for resource ${link.id}`);
          failedCount++;
          continue;
        }
        
        // Update the document in the batch
        if (!isDryRun) {
          batch.update(docRef, { [fieldToUpdate]: fixedUrl });
        }
        
        console.log(`  Would update ${fieldToUpdate} field to: ${fixedUrl}`);
        fixedCount++;
      } else {
        console.log(`  Could not fix URL format.`);
        failedCount++;
      }
    }
    
    // Commit the batch if not in dry run mode
    if (fixedCount > 0 && !isDryRun) {
      await batch.commit();
      console.log(`\nSuccessfully updated ${fixedCount} URLs in the database!`);
    } else if (isDryRun) {
      console.log(`\n[DRY RUN] Would have updated ${fixedCount} URLs in the database.`);
    }
    
    // Generate summary
    console.log(`\n=========== URL FIX SUMMARY ===========`);
    console.log(`Total invalid URLs attempted: ${invalidUrlLinks.length}`);
    console.log(`Successfully fixed: ${fixedCount}`);
    console.log(`Failed to fix: ${failedCount}`);
    
    if (isDryRun) {
      console.log(`\nThis was a dry run. No changes were made to the database.`);
      console.log(`To apply these changes, run the script without the --dry-run flag.`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error fixing URLs:", error);
    process.exit(1);
  }
}

// Run the fix
fixInvalidUrls(); 