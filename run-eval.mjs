#!/usr/bin/env node

/**
 * Eval Runner Script
 * 
 * Submits an eval to the Travrse API, polls for completion, and displays results
 * 
 * Usage:
 *   TRAVRSE_API_KEY=your_key node run-eval.mjs [config.json] [summary-output.md]
 *
 * Environment Variables:
 *   TRAVRSE_API_KEY or TV_API_KEY - API key for authentication (required)
 *   TRAVRSE_API_URL - API base URL (default: https://api.travrse.ai)
 *   POLL_INTERVAL_MS - Polling interval in milliseconds (default: 5000)
 *   MAX_WAIT_MS - Maximum wait time in milliseconds (default: 1800000 = 30 minutes)
 *
 * Defaults:
 *   Config file - ./product-eval.json
 *   Summary output - ./eval-summary.md
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const API_KEY = process.env.TRAVRSE_API_KEY || process.env.TV_API_KEY;
let API_BASE_URL = process.env.TRAVRSE_API_URL || 'https://api.travrse.ai';
const API_VERSION = 'v1';

// Normalize API_BASE_URL - remove trailing /api if present, we'll add /v1 ourselves
if (API_BASE_URL.endsWith('/api')) {
  API_BASE_URL = API_BASE_URL.slice(0, -4);
}
// Remove trailing slash
API_BASE_URL = API_BASE_URL.replace(/\/$/, '');
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const MAX_WAIT_MS = parseInt(process.env.MAX_WAIT_MS || '1800000', 10); // 30 minutes

const DEFAULT_CONFIG_FILENAME = 'product-eval.json';
const DEFAULT_SUMMARY_OUTPUT = 'eval-summary.md';

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost) {
  if (cost === null || cost === undefined) return 'N/A';
  return `$${cost.toFixed(4)}`;
}

function truncateText(text, maxLength = 50) {
  if (!text) return '';
  if (typeof text !== 'string') {
    text = JSON.stringify(text);
  }
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// API functions
async function makeRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}/${API_VERSION}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
    ...options.headers
  };

  // Debug logging
  if (process.env.DEBUG) {
    console.log(`🔍 Making ${options.method || 'GET'} request to: ${url}`);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
    
    if (response.status === 404) {
      errorMessage += `\n\n⚠️  The endpoint was not found. Possible issues:`;
      errorMessage += `\n   1. Make sure you're using the correct API URL (current: ${API_BASE_URL})`;
      errorMessage += `\n   2. If using local API, ensure it's running: cd apps/api && pnpm dev:api`;
      errorMessage += `\n   3. If using production, ensure the latest code is deployed`;
      errorMessage += `\n   4. Check that the endpoint path is correct: ${url}`;
    }
    
    errorMessage += `\n\nResponse: ${errorText}`;
    throw new Error(errorMessage);
  }

  return response.json();
}

async function submitEval(evalConfig) {
  console.log('📤 Submitting eval...');
  console.log(`   URL: ${API_BASE_URL}/${API_VERSION}/eval/submit`);
  const response = await makeRequest('/eval/submit', {
    method: 'POST',
    body: JSON.stringify(evalConfig)
  });
  
  // Handle both camelCase and snake_case responses
  const evalGroupId = response.eval_group_id || response.evalGroupId;
  const totalEvals = response.total_evals || response.totalEvals;
  const submissions = response.submissions || [];
  
  console.log(`✅ Eval submitted successfully`);
  console.log(`   Eval Group ID: ${evalGroupId}`);
  console.log(`   Total Evals: ${totalEvals}`);
  console.log(`   Submissions: ${submissions.length}`);
  
  // Normalize submissions to snake_case for consistency
  const normalizedSubmissions = submissions.map(s => ({
    eval_name: s.eval_name || s.evalName,
    batch_execution_id: s.batch_execution_id || s.batchExecutionId,
    status: s.status,
    queue_name: s.queue_name || s.queueName
  }));
  
  return {
    eval_group_id: evalGroupId,
    total_evals: totalEvals,
    submissions: normalizedSubmissions
  };
}

async function getEvalBatches(status = null) {
  const queryParams = status ? `?status=${status}` : '';
  return makeRequest(`/eval/batches${queryParams}`);
}

async function getEvalResults(batchExecutionId) {
  return makeRequest(`/eval/${batchExecutionId}/results`);
}

async function pollForCompletion(submissions, startTime) {
  const batchIds = submissions.map(s => s.batch_execution_id);
  const batchIdToSubmission = {};
  submissions.forEach(s => {
    batchIdToSubmission[s.batch_execution_id] = s;
  });

  console.log(`\n⏳ Polling for completion (checking every ${POLL_INTERVAL_MS / 1000}s)...`);
  
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_WAIT_MS) {
      throw new Error(`Maximum wait time exceeded (${formatDuration(MAX_WAIT_MS)})`);
    }

    try {
      const batchesResponse = await getEvalBatches();
      const batches = batchesResponse.batches || [];
      
      // Filter to only our batches (handle both snake_case and camelCase)
      const ourBatches = batches.filter(b => {
        const batchId = b.batch_execution_id || b.batchExecutionId;
        return batchIds.includes(batchId);
      });
      
      const statusCounts = {};
      ourBatches.forEach(batch => {
        statusCounts[batch.status] = (statusCounts[batch.status] || 0) + 1;
      });

      const statusStr = Object.entries(statusCounts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(', ');
      
      console.log(`   [${formatDuration(elapsed)}] Status: ${statusStr}`);

      // Check if all are completed or failed
      const allFinished = ourBatches.every(batch => 
        batch.status === 'completed' || batch.status === 'failed'
      );

      if (allFinished) {
        console.log('✅ All batches completed!\n');
        return ourBatches;
      }

      // Wait before next poll
      await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      console.error(`   ⚠️  Error polling: ${error.message}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function calculateTotalCost(results) {
  if (!results.results_by_record) return 0;
  
  let totalCost = 0;
  for (const recordId in results.results_by_record) {
    const stepResults = results.results_by_record[recordId];
    for (const stepResult of stepResults) {
      const cost = stepResult.total_cost !== null && stepResult.total_cost !== undefined
        ? stepResult.total_cost
        : (stepResult.totalCost !== null && stepResult.totalCost !== undefined
          ? stepResult.totalCost
          : 0);
      totalCost += cost;
    }
  }
  return totalCost;
}

function generateSummaryTable(batches, detailedResultsMap) {
  const lines = [
    '## Summary',
    '',
    '| Eval Name | Total Records | Processed | Failed | Status | Total Cost |',
    '|-----------|---------------|-----------|--------|--------|------------|'
  ];

  for (const batch of batches) {
    // Calculate total cost from detailed results if available
    let totalCost = 0;
    const batchId = batch.batch_execution_id || batch.batchExecutionId;
    if (detailedResultsMap && detailedResultsMap[batchId]) {
      totalCost = calculateTotalCost(detailedResultsMap[batchId]);
    }

    const costStr = totalCost > 0 ? formatCost(totalCost) : 'N/A';
    const evalName = batch.eval_name || batch.evalName || 'N/A';
    const status = batch.status;
    const totalRecords = batch.total_records || batch.totalRecords || 0;
    const processedRecords = batch.processed_records || batch.processedRecords || 0;
    const failedRecords = batch.failed_records || batch.failedRecords || 0;

    lines.push(`| ${evalName} | ${totalRecords} | ${processedRecords} | ${failedRecords} | ${status} | ${costStr} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function generateDetailedResultsMarkdown(results) {
  const lines = [];
  const evalName = results.eval_name || results.evalName || 'Unknown';
  lines.push(`## Detailed Results: ${evalName}`);
  lines.push('');
  
  const resultsByRecord = results.results_by_record || {};
  const recordIds = Object.keys(resultsByRecord);
  
  if (recordIds.length === 0) {
    lines.push('No results found.');
    lines.push('');
    return lines.join('\n');
  }

  for (const recordId of recordIds) {
    const stepResults = resultsByRecord[recordId];
    if (stepResults.length === 0) continue;

    const firstResult = stepResults[0];
    const recordName = firstResult.record_name || firstResult.recordName || recordId;
    
    lines.push(`### Record: ${recordName}`);
    lines.push('');
    lines.push('| Step Name | Step Type | Model | Duration (ms) | Cost | Output Preview |');
    lines.push('|-----------|-----------|-------|---------------|------|----------------|');
    
    for (const stepResult of stepResults) {
      const stepName = stepResult.step_name || stepResult.stepName || 'N/A';
      const stepType = stepResult.step_type || stepResult.stepType || 'N/A';
      const model = stepResult.model_used || stepResult.modelUsed || 'N/A';
      const duration = stepResult.duration_ms !== null && stepResult.duration_ms !== undefined 
        ? `${stepResult.duration_ms}` 
        : (stepResult.durationMs !== null && stepResult.durationMs !== undefined 
          ? `${stepResult.durationMs}` 
          : 'N/A');
      const cost = stepResult.total_cost !== null && stepResult.total_cost !== undefined
        ? formatCost(stepResult.total_cost)
        : (stepResult.totalCost !== null && stepResult.totalCost !== undefined
          ? formatCost(stepResult.totalCost)
          : 'N/A');
      const outputPreview = truncateText(stepResult.output || stepResult.outputPreview, 40);
      
      lines.push(`| ${stepName} | ${stepType} | ${model} | ${duration} | ${cost} | ${outputPreview} |`);
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

function displayDetailedResults(results) {
  const evalName = results.eval_name || results.evalName || 'Unknown';
  console.log(`## Detailed Results: ${evalName}\n`);
  
  const resultsByRecord = results.results_by_record || {};
  const recordIds = Object.keys(resultsByRecord);
  
  if (recordIds.length === 0) {
    console.log('No results found.\n');
    return;
  }

  for (const recordId of recordIds) {
    const stepResults = resultsByRecord[recordId];
    if (stepResults.length === 0) continue;

    const firstResult = stepResults[0];
    const recordName = firstResult.record_name || firstResult.recordName || recordId;
    
    console.log(`### Record: ${recordName}\n`);
    console.log('| Step Name | Step Type | Model | Duration (ms) | Cost | Output Preview |');
    console.log('|-----------|-----------|-------|---------------|------|----------------|');
    
    for (const stepResult of stepResults) {
      const stepName = stepResult.step_name || stepResult.stepName || 'N/A';
      const stepType = stepResult.step_type || stepResult.stepType || 'N/A';
      const model = stepResult.model_used || stepResult.modelUsed || 'N/A';
      const duration = stepResult.duration_ms !== null && stepResult.duration_ms !== undefined 
        ? `${stepResult.duration_ms}` 
        : (stepResult.durationMs !== null && stepResult.durationMs !== undefined 
          ? `${stepResult.durationMs}` 
          : 'N/A');
      const cost = stepResult.total_cost !== null && stepResult.total_cost !== undefined
        ? formatCost(stepResult.total_cost)
        : (stepResult.totalCost !== null && stepResult.totalCost !== undefined
          ? formatCost(stepResult.totalCost)
          : 'N/A');
      const outputPreview = truncateText(stepResult.output || stepResult.outputPreview, 40);
      
      console.log(`| ${stepName} | ${stepType} | ${model} | ${duration} | ${cost} | ${outputPreview} |`);
    }
    
    console.log('');
  }
}

async function main() {
  // Validate API key
  if (!API_KEY) {
    console.error('❌ Error: API key not found');
    console.error('');
    console.error('Please set one of the following environment variables:');
    console.error('  TRAVRSE_API_KEY=your_key');
    console.error('  TV_API_KEY=your_key');
    console.error('');
    process.exit(1);
  }

  // Load eval config (support command line argument for file path)
  const configFile = process.argv[2];
  const configPath = configFile
    ? resolve(process.cwd(), configFile)
    : resolve(__dirname, DEFAULT_CONFIG_FILENAME);

  let evalConfig;
  try {
    const fileContent = readFileSync(configPath, 'utf8');
    evalConfig = JSON.parse(fileContent);
    console.log(`📄 Loaded eval config from: ${configPath}\n`);
  } catch (error) {
    console.error(`❌ Error loading config file: ${error.message}`);
    process.exit(1);
  }

  const summaryOutputArg = process.argv[3];
  const summaryOutputPath = resolve(
    process.cwd(),
    summaryOutputArg || DEFAULT_SUMMARY_OUTPUT
  );

  console.log('🚀 Travrse Eval Runner\n');
  console.log(`API URL: ${API_BASE_URL}`);
  console.log(`API Version: ${API_VERSION}`);
  console.log(`Full Base: ${API_BASE_URL}/${API_VERSION}`);
  console.log(`Flow: ${evalConfig.flow_definition?.name || 'N/A'}`);
  console.log(`Records: ${evalConfig.records?.length || 0}`);
  console.log(`Eval Configs: ${evalConfig.eval_configs?.length || 0}\n`);
  
  // Warn if using production URL
  if (API_BASE_URL.includes('api.travrse.ai') && !API_BASE_URL.includes('localhost')) {
    console.log('⚠️  Using production API. Make sure your changes are deployed!\n');
  }

  try {
    // Submit eval
    const submitResponse = await submitEval(evalConfig);
    
    // Poll for completion
    const startTime = Date.now();
    const completedBatches = await pollForCompletion(submitResponse.submissions, startTime);
    
    // Fetch detailed results
    console.log('📊 Fetching detailed results...\n');
    const detailedResults = [];
    const detailedResultsMap = {};
    
    for (const batch of completedBatches) {
      try {
        const batchId = batch.batch_execution_id || batch.batchExecutionId;
        if (!batchId) {
          console.error(`⚠️  Skipping batch: missing batch_execution_id`);
          continue;
        }
        const results = await getEvalResults(batchId);
        detailedResults.push(results);
        detailedResultsMap[batchId] = results;
      } catch (error) {
        const batchId = batch.batch_execution_id || batch.batchExecutionId || 'unknown';
        console.error(`⚠️  Error fetching results for ${batchId}: ${error.message}`);
      }
    }

    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('📋 EVAL RESULTS');
    console.log('='.repeat(80) + '\n');
    
    // Summary table (with costs calculated from detailed results)
    const summaryMarkdown = generateSummaryTable(completedBatches, detailedResultsMap);
    console.log(summaryMarkdown + '\n');

    // Generate detailed results markdown
    const detailedResultsMarkdown = detailedResults
      .map(results => generateDetailedResultsMarkdown(results))
      .join('\n\n');

    // Combine summary and detailed results
    const fullMarkdown = summaryMarkdown + '\n' + detailedResultsMarkdown;

    try {
      writeFileSync(summaryOutputPath, fullMarkdown + '\n', 'utf8');
      console.log(`📝 Summary and detailed results saved to ${summaryOutputPath}\n`);
    } catch (error) {
      console.error(`⚠️  Failed to write results to file: ${error.message}`);
    }
    
    // Detailed results (console output)
    for (const results of detailedResults) {
      displayDetailedResults(results);
    }
    
    console.log('='.repeat(80));
    console.log('✅ Eval run completed!\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main();

