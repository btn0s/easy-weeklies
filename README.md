# Easy Weeklies

A small utility for generating weekly reports from Linear.

This script generates a report of the user's active projects, completed tasks in the past week, and upcoming tasks for the next week using the Linear API. The report is saved in both Markdown and HTML formats.

## Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Create a Linear API key [here](https://linear.app/settings/api)
4. Copy `.env.example` to `.env` and fill in the values with your Linear API key, as well as flip the `SAVE_TO_DESKTOP` flag to true if you want to save the report to your desktop

## Usage

1. Run `npm run start` to start the script
2. The script will fetch data from Linear API and generate a weekly report
3. The report will be saved in the `reports` folder on your desktop (or in the current directory) in both Markdown (report.md) and HTML (report.html) formats
4. Insert the report into your email and send!

Example output can be found [here](https://github.com/btn0s/easy-weeklies/blob/main/examples/report.md).
