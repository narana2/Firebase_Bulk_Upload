// Import Firebase Admin SDK
const admin = require("firebase-admin");
const fs = require('fs');

// Import service account credentials
const serviceAccount = require("./serviceAccountKey-BetterResources.json");

// Initialize Firebase Admin instance
const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore reference
const db = app.firestore();

// Helper function to process category values (handles comma-separated values)
function processCategoryValues(value) {
  if (typeof value === 'string' && value.includes(',')) {
    // Handle comma-separated values
    return value.split(',').map(v => v.trim());
  }
  return [value];
}

// Main function to analyze resources
async function analyzeResources() {
  try {
    console.log("Starting resource analysis...");
    
    // Report object to store all analysis results
    const report = {
      generatedAt: new Date().toISOString(),
      totalResources: 0,
      fieldAnalysis: {},
      urlAnalysis: null
    };
    
    // Get all documents from resourcesApp collection
    const snapshot = await db.collection("resourcesApp").get();
    
    // Count total resources
    const totalResources = snapshot.size;
    report.totalResources = totalResources;
    console.log(`Total resources: ${totalResources}`);
    
    // Get a list of all fields used across all documents
    const allFields = new Set();
    const fieldFrequency = {};
    
    snapshot.forEach(doc => {
      const data = doc.data();
      Object.keys(data).forEach(field => {
        allFields.add(field);
        fieldFrequency[field] = (fieldFrequency[field] || 0) + 1;
      });
    });
    
    // Print example document structure for debugging
    if (snapshot.size > 0) {
      const exampleDoc = snapshot.docs[0].data();
      console.log("\nExample document structure:");
      console.log(JSON.stringify(exampleDoc, null, 2));
      
      report.exampleDocument = exampleDoc;
    }
    
    // Show fields overview
    console.log("\nFields overview:");
    console.log("===============");
    
    const sortedFields = Object.entries(fieldFrequency)
      .sort((a, b) => b[1] - a[1])
      .map(([field, count]) => {
        const percentage = ((count / totalResources) * 100).toFixed(1);
        console.log(`${field}: present in ${count}/${totalResources} resources (${percentage}%)`);
        return {
          name: field,
          count,
          percentage: parseFloat(percentage)
        };
      });
    
    report.fieldsOverview = sortedFields;
    
    // Fields to always analyze in-depth (field name and friendly display name)
    const priorityFields = [
      { key: 'Resource Type', display: 'Resource Type' },
      { key: 'state', display: 'State' },
      { key: 'title', display: 'Title' }
    ];
    
    // Add other frequent fields (present in >50% of resources) to analysis
    const fieldsToAnalyze = [...priorityFields];
    
    sortedFields.forEach(field => {
      if (field.percentage > 50 && !priorityFields.some(pf => pf.key === field.name)) {
        fieldsToAnalyze.push({
          key: field.name,
          display: field.name.charAt(0).toUpperCase() + field.name.slice(1)
        });
      }
    });
    
    // Analyze each field of interest
    for (const field of fieldsToAnalyze) {
      console.log(`\n\n=====================`);
      console.log(`Analyzing: ${field.display}`);
      console.log(`=====================`);
      
      // Skip analyzing the URL field here (we'll do it separately)
      if (field.key.toLowerCase().includes('url') || 
          field.key.toLowerCase().includes('website') || 
          field.key.toLowerCase().includes('link')) {
        console.log(`Skipping URL field analysis here (will be done separately)`);
        continue;
      }
      
      // Create map to store counts
      const valueCounts = {};
      let fieldExists = false;
      let totalFieldInstances = 0;
      
      // Process each document
      snapshot.forEach(doc => {
        const data = doc.data();
        const fieldValue = data[field.key];
        
        if (fieldValue !== undefined) {
          fieldExists = true;
          
          if (Array.isArray(fieldValue)) {
            // Handle array fields
            fieldValue.forEach(value => {
              valueCounts[value] = (valueCounts[value] || 0) + 1;
              totalFieldInstances++;
            });
          } else {
            // Handle scalar fields, including comma-separated values
            const values = processCategoryValues(fieldValue);
            values.forEach(value => {
              valueCounts[value] = (valueCounts[value] || 0) + 1;
              totalFieldInstances++;
            });
          }
        } else {
          // Count resources with no value for this field
          valueCounts['Not specified'] = (valueCounts['Not specified'] || 0) + 1;
        }
      });
      
      if (fieldExists) {
        // Display results
        const presentCount = totalResources - (valueCounts['Not specified'] || 0);
        console.log(`Field found in ${presentCount}/${totalResources} resources (${((presentCount/totalResources) * 100).toFixed(1)}%)`);
        
        // Check if we have comma-separated or array values
        const hasMultipleValues = totalFieldInstances > presentCount;
        if (hasMultipleValues) {
          console.log(`Some resources have multiple ${field.display.toLowerCase()} values`);
        }
        
        // Sort values by count (descending)
        const sortedValues = Object.entries(valueCounts)
          .sort((a, b) => b[1] - a[1]);
        
        // Print each value and count
        console.log(`\n${field.display} counts:`);
        console.log("------------------------");
        
        const valueAnalysis = sortedValues.map(([value, count]) => {
          const percentage = ((count / totalResources) * 100).toFixed(1);
          console.log(`${value}: ${count} resources (${percentage}%)`);
          return {
            value,
            count,
            percentage: parseFloat(percentage)
          };
        });
        
        // Print unique value count
        const uniqueCount = sortedValues.length - (valueCounts['Not specified'] ? 1 : 0);
        console.log(`\nTotal unique ${field.display.toLowerCase()} values: ${uniqueCount}`);
        
        // Add to report
        report.fieldAnalysis[field.key] = {
          displayName: field.display,
          presentInResources: presentCount,
          percentagePresent: parseFloat(((presentCount/totalResources) * 100).toFixed(1)),
          hasMultipleValues,
          uniqueValueCount: uniqueCount,
          values: valueAnalysis
        };
      } else {
        console.log(`Field "${field.key}" not found in any resources`);
        report.fieldAnalysis[field.key] = {
          displayName: field.display,
          presentInResources: 0,
          percentagePresent: 0,
          hasMultipleValues: false,
          uniqueValueCount: 0,
          values: []
        };
      }
    }
    
    // Now check for URL field and analyze broken links
    const urlFields = ['url', 'website', 'link', 'URL', 'Website', 'Link'];
    let urlField = null;
    
    // Find the first URL field that exists
    for (const field of urlFields) {
      let fieldExists = false;
      snapshot.docs.some(doc => {
        if (doc.data()[field] !== undefined) {
          fieldExists = true;
          return true;
        }
        return false;
      });
      
      if (fieldExists) {
        urlField = field;
        break;
      }
    }
    
    // If we found a URL field, analyze working vs non-working links
    if (urlField) {
      console.log(`\n\n=====================`);
      console.log(`URL Status Analysis (Field: ${urlField})`);
      console.log(`=====================`);
      
      let resourcesWithUrl = 0;
      const urlValues = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data[urlField]) {
          resourcesWithUrl++;
          urlValues[data[urlField]] = (urlValues[data[urlField]] || 0) + 1;
        }
      });
      
      const urlPercentage = ((resourcesWithUrl / totalResources) * 100).toFixed(1);
      console.log(`Resources with ${urlField}: ${resourcesWithUrl}/${totalResources} (${urlPercentage}%)`);
      
      // Count duplicate URLs
      const duplicateUrls = Object.entries(urlValues)
        .filter(([_, count]) => count > 1)
        .sort((a, b) => b[1] - a[1]);
      
      if (duplicateUrls.length > 0) {
        console.log(`\nDuplicate URLs (${duplicateUrls.length} found):`);
        duplicateUrls.forEach(([url, count]) => {
          console.log(`- ${url}: used in ${count} resources`);
        });
      }
      
      // Build URL analysis object for report
      report.urlAnalysis = {
        urlField,
        resourcesWithUrl,
        percentageWithUrl: parseFloat(urlPercentage),
        duplicateUrls: duplicateUrls.map(([url, count]) => ({ url, count }))
      };
      
      // Reference the broken links data if available
      try {
        const brokenLinksReport = require('./broken_links_report.json');
        
        // Add broken links info to console output
        console.log(`\nBroken links report summary:`);
        console.log(`- Total resources analyzed: ${brokenLinksReport.summary.totalResources}`);
        console.log(`- Working links: ${brokenLinksReport.summary.workingLinks} (${((brokenLinksReport.summary.workingLinks / brokenLinksReport.summary.totalResources) * 100).toFixed(1)}%)`);
        console.log(`- Broken links: ${brokenLinksReport.summary.brokenLinks} (${((brokenLinksReport.summary.brokenLinks / brokenLinksReport.summary.totalResources) * 100).toFixed(1)}%)`);
        
        // Analyze error types
        const errorTypes = {};
        brokenLinksReport.brokenLinks.forEach(link => {
          const errorType = link.error.split(':')[0];
          errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
        });
        
        console.log(`\nTop error types:`);
        const sortedErrorTypes = Object.entries(errorTypes)
          .sort((a, b) => b[1] - a[1]);
        
        sortedErrorTypes.forEach(([type, count]) => {
          console.log(`- ${type}: ${count} resources`);
        });
        
        // Add broken links info to report
        report.urlAnalysis.brokenLinks = {
          summary: brokenLinksReport.summary,
          errorTypes: sortedErrorTypes.map(([type, count]) => ({ type, count }))
        };
      } catch (error) {
        console.log('No broken links report found or error accessing it.');
      }
    }
    
    // Save the report to a file
    const reportFilename = `resource_analysis_report_${new Date().toISOString().substring(0, 10)}.json`;
    fs.writeFileSync(reportFilename, JSON.stringify(report, null, 2));
    console.log(`\n\nReport saved to ${reportFilename}`);
    
    // Clean up
    await app.delete();
    
  } catch (error) {
    console.error("Error analyzing resources:", error);
  }
}

// Run the analysis
analyzeResources(); 