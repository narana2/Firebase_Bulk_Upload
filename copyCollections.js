// Import Firebase Admin SDK
const admin = require("firebase-admin");

// Import service account credentials for both projects
const sourceServiceAccount = require("./serviceAccountKey-BetterEDU.json");
const destServiceAccount = require("./serviceAccountKey-BetterResources.json");

// Initialize Firebase Admin instances for both projects
const sourceApp = admin.initializeApp({
  credential: admin.credential.cert(sourceServiceAccount)
}, 'source');

const destApp = admin.initializeApp({
  credential: admin.credential.cert(destServiceAccount)
}, 'destination');

// Get Firestore references
const sourceDb = sourceApp.firestore();
const destDb = destApp.firestore();

// Collections to copy
const collections = ['feedback', 'resourcesApp'];

// Function to copy a collection
async function copyCollection(collectionName) {
  console.log(`Starting to copy collection: ${collectionName}`);
  
  try {
    // Get all documents from source collection
    const snapshot = await sourceDb.collection(collectionName).get();
    
    // Copy each document to destination
    const promises = snapshot.docs.map(async (doc) => {
      const data = doc.data();
      await destDb.collection(collectionName).doc(doc.id).set(data);
      console.log(`Copied document ${doc.id} in collection ${collectionName}`);
    });
    
    await Promise.all(promises);
    console.log(`Finished copying collection: ${collectionName}`);
  } catch (error) {
    console.error(`Error copying collection ${collectionName}:`, error);
    throw error;
  }
}

// Main function to copy all collections
async function copyCollections() {
  try {
    console.log("Starting collection copy process...");
    
    // Copy each collection sequentially
    for (const collection of collections) {
      await copyCollection(collection);
    }
    
    console.log("All collections copied successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error in copy process:", error);
    process.exit(1);
  }
}

// Run the copy process
copyCollections(); 