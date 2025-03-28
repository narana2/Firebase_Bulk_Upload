// Import Firebase Admin SDK
const admin = require("firebase-admin");
const fs = require('fs');

// Import service account credentials
const serviceAccount = require("./serviceAccountKey-BetterResources.json");

// Initialize Firebase Admin
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = app.firestore();

// Read and parse the discounts markdown file
const discountsData = fs.readFileSync('discounts.md', 'utf8');
const discountsJson = JSON.parse(discountsData);
const newDiscounts = discountsJson.student_discounts;

// Check if --dry-run flag is present
const isDryRun = process.argv.includes('--dry-run');

async function uploadNewDiscounts() {
  try {
    console.log(isDryRun ? "DRY RUN: Simulating upload process..." : "Starting to check and upload student discounts...");
    
    // Get existing discounts
    const existingDocs = await db.collection("studentDisc").get();
    const existingIds = new Set(existingDocs.docs.map(doc => doc.id));
    
    // Create a batch for new documents
    const batch = db.batch();
    let newCount = 0;
    let skipCount = 0;
    
    // Add each new discount to the batch
    for (const discount of newDiscounts) {
      if (!existingIds.has(discount.id)) {
        if (!isDryRun) {
          const docRef = db.collection("studentDisc").doc(discount.id);
          batch.set(docRef, discount);
        }
        newCount++;
        console.log(`${isDryRun ? '[DRY RUN] Would add' : 'Adding'} new discount: ${discount.name}`);
        console.log('  ID:', discount.id);
        console.log('  Category:', discount.category);
        console.log('  Discount:', discount.discount);
        console.log('---');
      } else {
        skipCount++;
        console.log(`${isDryRun ? '[DRY RUN] Would skip' : 'Skipping'} existing discount: ${discount.name}`);
      }
    }
    
    if (newCount > 0 && !isDryRun) {
      // Commit the batch if there are new documents
      await batch.commit();
      console.log(`Successfully added ${newCount} new discounts!`);
    }
    
    console.log(`\nSummary:`);
    console.log(`${isDryRun ? 'Would add' : 'Added'} ${newCount} new discounts`);
    console.log(`${isDryRun ? 'Would skip' : 'Skipped'} ${skipCount} existing discounts`);
    console.log(`Total discounts in file: ${newDiscounts.length}`);
    console.log(`\n${isDryRun ? 'Dry run completed' : 'Operation completed'} successfully!`);
    
    if (isDryRun) {
      console.log('\nTo perform the actual upload, run the script without --dry-run');
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the upload
uploadNewDiscounts(); 