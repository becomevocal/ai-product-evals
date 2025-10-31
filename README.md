# AI Product Eval Runner Demo

This directory contains scripts and configuration files for running product focused evals against the Travrse API. Put together for an SF AI Tinkerers talk @ Okta.

## Files

- **`run-eval.mjs`** - Main script that submits evals, polls for completion, and displays results
- **`product-eval.json`** - Sample eval configuration file that tests a local car finder AI flow with multiple steps, models, and tools
- **`product-eval-alt.json`** - Same product flow with Exa search used as an integration instead of using LLM with Exa search tool
- **`tool-eval.json`** - Sample eval configuration file that tests multiple tool calls across Mixlayer and Together

## Usage

### Basic Command

```bash
TRAVRSE_API_KEY=your_key node run-eval.mjs
```

This will:
- Load `product-eval.json` by default
- Submit the eval to the Travrse API
- Poll for completion
- Display results in the console
- Save summary and detailed results to `eval-summary.md`

### Custom Config File

```bash
TRAVRSE_API_KEY=your_key node run-eval.mjs tool-eval.json
```

### Custom Output File

```bash
TRAVRSE_API_KEY=your_key node run-eval.mjs product-eval.json custom-results.md
```

## Environment Variables

- **`TRAVRSE_API_KEY`** or **`TV_API_KEY`** - API key for authentication (required)
- **`TRAVRSE_API_URL`** - API base URL (default: `https://api.travrse.ai`)
- **`POLL_INTERVAL_MS`** - Polling interval in milliseconds (default: `5000`)
- **`MAX_WAIT_MS`** - Maximum wait time in milliseconds (default: `1800000` = 30 minutes)
- **`DEBUG`** - Enable debug logging (set to any value)

## Examples

### Using Local API

```bash
TRAVRSE_API_KEY=your_key TRAVRSE_API_URL=http://localhost:8787 node run-eval.mjs
```

### Custom Polling Interval

```bash
TRAVRSE_API_KEY=your_key POLL_INTERVAL_MS=10000 node run-eval.mjs
```

### With Debug Logging

```bash
TRAVRSE_API_KEY=your_key DEBUG=1 node run-eval.mjs
```

## Output

The script generates a markdown file with:
- **Summary table** - Overview of all eval runs with totals, processed/failed counts, status, and costs
- **Detailed results** - Per-record breakdown with step-by-step execution details including:
  - Step name and type
  - Model used
  - Duration
  - Cost
  - Output preview

Results are displayed in the console and saved to the output file (default: `eval-summary.md`).

