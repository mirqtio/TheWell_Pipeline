const { Pool } = require('pg');
const FeedbackDAO = require('./src/database/FeedbackDAO');

async function debugFeedback() {
  const db = new Pool({
    user: 'charlieirwin',
    host: 'localhost',
    database: 'thewell_pipeline_test',
    password: '',
    port: 5432,
  });

  const feedbackDAO = new FeedbackDAO(db);

  try {
    // First, let's see what feedback exists
    console.log('Checking existing feedback...');
    const allFeedback = await db.query('SELECT * FROM feedback LIMIT 5');
    console.log('Existing feedback:', allFeedback.rows);

    if (allFeedback.rows.length > 0) {
      const testId = allFeedback.rows[0].id;
      console.log(`\nTesting getFeedbackById with ID: ${testId}`);
      
      try {
        const feedback = await feedbackDAO.getFeedbackById(testId);
        console.log('Result:', feedback);
      } catch (error) {
        console.error('Error in getFeedbackById:', error);
      }
    }

    // Test document feedback
    console.log('\nChecking documents...');
    const documents = await db.query('SELECT * FROM documents LIMIT 5');
    console.log('Existing documents:', documents.rows);

    if (documents.rows.length > 0) {
      const testDocId = documents.rows[0].id;
      console.log(`\nTesting getFeedbackByDocumentId with ID: ${testDocId}`);
      
      try {
        const feedback = await feedbackDAO.getFeedbackByDocumentId(testDocId);
        console.log('Result:', feedback);
      } catch (error) {
        console.error('Error in getFeedbackByDocumentId:', error);
      }
    }

  } catch (error) {
    console.error('Debug error:', error);
  } finally {
    await db.end();
  }
}

debugFeedback();
