# Firebase Bulk Upload Tool

A Node.js tool for bulk uploading data to Firebase. This tool helps upload structured resource data to a Firebase database.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure Firebase:
   - Create a Firebase project
   - Generate a service account key from Firebase Console
   - Save it as `serviceAccountKey.json` in the project root

## Usage

Run the upload script:
```bash
node uploadData.js
```

## Data Structure

The tool uploads resource data from `resources.json`, which contains information about various educational and support resources. 