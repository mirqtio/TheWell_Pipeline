#!/usr/bin/env node

/**
 * Task Master CLI - Simple task management for TheWell Pipeline
 */

const fs = require('fs');
const path = require('path');

const TASKS_FILE = path.join(__dirname, '../tasks/tasks.json');
const TASK_004_FILE = path.join(__dirname, '../tasks/task_004.txt');

function loadTasks() {
  try {
    const tasksData = fs.readFileSync(TASKS_FILE, 'utf8');
    return JSON.parse(tasksData);
  } catch (error) {
    console.error('Error loading tasks:', error.message);
    return null;
  }
}

function loadTask004() {
  try {
    return fs.readFileSync(TASK_004_FILE, 'utf8');
  } catch (error) {
    console.error('Error loading task 004:', error.message);
    return null;
  }
}

function showStatus() {
  const task004Content = loadTask004();
  if (!task004Content) return;

  console.log('\n=== TASK MASTER STATUS ===\n');
  
  // Parse task 004 status
  const lines = task004Content.split('\n');
  const statusLine = lines.find(line => line.startsWith('# Status:'));
  const titleLine = lines.find(line => line.startsWith('# Title:'));
  
  if (titleLine && statusLine) {
    console.log(`Current Task: ${titleLine.replace('# Title: ', '')}`);
    console.log(`Status: ${statusLine.replace('# Status: ', '').toUpperCase()}`);
  }

  console.log('\nTask 4 Subtasks:');
  console.log('4.1 RAG API Scaffolding ✅ COMPLETED');
  console.log('4.2 Hybrid Search Implementation ✅ COMPLETED'); 
  console.log('4.3 Caching System ✅ COMPLETED');
  console.log('4.4 API Documentation ✅ COMPLETED');
  console.log('4.5 Permission Enforcement 🔄 IN-PROGRESS (fixing test failures)');
  console.log('4.6 Performance Optimization ⏳ PENDING');
  console.log('4.7 Contract Testing ⏳ PENDING');

  console.log('\nCurrent Issues:');
  console.log('- Migration integration tests failing (table conflicts)');
  console.log('- Need to complete permission enforcement test fixes');
  console.log('- Need CI validation after local test fixes');
}

function showHelp() {
  console.log('\n=== TASK MASTER CLI ===\n');
  console.log('Available commands:');
  console.log('  status    - Show current task status');
  console.log('  help      - Show this help message');
  console.log('  next      - Show next steps');
}

function showNext() {
  console.log('\n=== NEXT STEPS ===\n');
  console.log('1. Fix migration test failures (table conflict issues)');
  console.log('2. Ensure all system tests pass locally');
  console.log('3. Commit and push fixes to main');
  console.log('4. Validate CI passes via GitHub');
  console.log('5. Mark Task 4.5 as complete');
  console.log('6. Begin Task 4.6 (Performance Optimization)');
}

// Parse command line arguments
const command = process.argv[2] || 'help';

switch (command) {
  case 'status':
    showStatus();
    break;
  case 'help':
    showHelp();
    break;
  case 'next':
    showNext();
    break;
  default:
    console.log(`Unknown command: ${command}`);
    showHelp();
}