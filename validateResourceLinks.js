// Import required modules
const admin = require("firebase-admin");
const axios = require("axios");
const fs = require("fs");

// Import service account credentials
const serviceAccount = require("./serviceAccountKey-BetterResources.json");

// Initialize Firebase Admin
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = app.firestore();

// Check if --dry-run flag is present
const isDryRun = process.argv.includes('--dry-run');
const outputFile = "broken_links_report.json";

async function validateResourceLinks() {
  try {
    console.log("Starting to validate resource links...");
    
    // Get all resources from the collection
    const resourcesSnapshot = await db.collection("resourcesApp").get();
    const totalResources = resourcesSnapshot.size;
    
    console.log(`Found ${totalResources} resources to validate.`);
    
    // Array to store broken links
    const brokenLinks = [];
    let processedCount = 0;
    let workingCount = 0;
    let brokenCount = 0;
    
    // Process each resource
    for (const doc of resourcesSnapshot.docs) {
      const resource = doc.data();
      processedCount++;
      
      // Extract the URL - adjust the field name if needed
      const url = resource.link || resource.url || resource.website;
      
      if (!url) {
        console.log(`Resource "${resource.name || doc.id}" has no URL to validate.`);
        continue;
      }
      
      try {
        // Print progress
        process.stdout.write(`Testing link ${processedCount}/${totalResources}: ${url.substring(0, 60)}${url.length > 60 ? '...' : ''}`);
        
        // Make a HEAD request first (faster) with a timeout
        const response = await axios({
          method: 'head',
          url: url,
          timeout: 10000, // 10 second timeout
          validateStatus: () => true // Don't throw errors for any status code
        });
        
        // Check if the status code indicates success (2xx) or a redirect (3xx)
        if (response.status >= 200 && response.status < 400) {
          workingCount++;
          process.stdout.write(" ✓\n");
        } else {
          brokenCount++;
          process.stdout.write(` ✗ (Status: ${response.status})\n`);
          brokenLinks.push({
            id: doc.id,
            name: resource.name || "No name",
            url: url,
            statusCode: response.status,
            error: `HTTP Status ${response.status}`
          });
        }
      } catch (error) {
        brokenCount++;
        process.stdout.write(" ✗\n");
        
        // Determine error type
        let errorMessage = "Unknown error";
        if (error.code === 'ECONNREFUSED') errorMessage = "Connection refused";
        else if (error.code === 'ECONNABORTED') errorMessage = "Connection timed out";
        else if (error.code === 'ENOTFOUND') errorMessage = "Domain not found";
        else if (error.message) errorMessage = error.message;
        
        console.log(`  Error: ${errorMessage}`);
        
        brokenLinks.push({
          id: doc.id,
          name: resource.name || "No name",
          url: url,
          statusCode: null,
          error: errorMessage
        });
      }
    }
    
    // Generate report
    console.log("\n\n=========== LINK VALIDATION SUMMARY ===========");
    console.log(`Total resources checked: ${totalResources}`);
    console.log(`Working links: ${workingCount}`);
    console.log(`Broken links: ${brokenCount}`);
    
    if (brokenLinks.length > 0) {
      console.log("\nBroken Links:");
      brokenLinks.forEach((link, index) => {
        console.log(`\n${index + 1}. ${link.name} (ID: ${link.id})`);
        console.log(`   URL: ${link.url}`);
        console.log(`   Error: ${link.error}`);
      });
      
      // Save report to file
      fs.writeFileSync(outputFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
          totalResources,
          workingLinks: workingCount,
          brokenLinks: brokenCount
        },
        brokenLinks
      }, null, 2));
      
      console.log(`\nDetailed report saved to ${outputFile}`);
    } else {
      console.log("\nAll links are working correctly!");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error validating links:", error);
    process.exit(1);
  }
}

// Run the validation
validateResourceLinks(); 