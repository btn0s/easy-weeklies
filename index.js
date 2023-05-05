import { LinearClient, LinearDocument } from "@linear/sdk";
import fs from "fs";
import * as os from "os";
import path from "path";
import * as dotenv from 'dotenv';
dotenv.config();
// Your API keys
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const SAVE_TO_DESKTOP = process.env.SAVE_TO_DESKTOP === 'true';
if (!LINEAR_API_KEY) {
    console.log("Please set your LINEAR_API_KEY environment variable.");
    process.exit(1);
}
// Configure Linear API client
const linearClient = new LinearClient({
    apiKey: LINEAR_API_KEY,
});
/**
 * Fetches the user's active projects from Linear.
 * @returns {Promise<Project[]>} An array of active projects.
 */
async function fetchMyProjects() {
    const me = await linearClient.viewer;
    const issues = await me.assignedIssues();
    const projectIds = new Set();
    for (const issue of issues.nodes) {
        const project = await issue.project;
        if (project && project.state === "started") {
            projectIds.add(project.id);
        }
    }
    const myProjects = await Promise.all(Array.from(projectIds).map(async (projectId) => {
        const proj = await linearClient.project(projectId);
        return {
            name: proj.name,
            description: proj.description || "no description",
            url: proj.url,
            startDate: proj.startedAt,
            targetDate: proj.targetDate,
        };
    }));
    // Calculate time remaining for each project
    const currentDate = new Date();
    myProjects.forEach((project) => {
        if (project.targetDate) {
            const remainingWorkDays = calculateWorkDaysRemaining(currentDate, new Date(project.targetDate));
            project.remainingWorkDays = remainingWorkDays;
        }
        else {
            project.remainingWorkDays = -1; // No target date
        }
    });
    // Sort projects based on remaining work days
    myProjects.sort((a, b) => {
        if (a.remainingWorkDays === -1) {
            return 1; // Projects with no target date go to the bottom
        }
        if (b.remainingWorkDays === -1) {
            return -1; // Projects with no target date go to the bottom
        }
        if (a.remainingWorkDays && b.remainingWorkDays) {
            return a.remainingWorkDays - b.remainingWorkDays;
        }
        return 0;
    });
    return myProjects;
}
/**
 * Fetches tasks completed in the past week.
 * @returns {Promise<Task[]>} An array of completed tasks.
 */
async function fetchCompletedIssues() {
    const me = await linearClient.viewer;
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const completedIssues = await me.assignedIssues({
        orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
        filter: {
            updatedAt: {
                gte: oneWeekAgo,
            },
            state: { type: { in: ["completed", "started"] } },
        },
    });
    const tasks = [];
    for (const issue of completedIssues.nodes) {
        const id = issue.identifier;
        const title = issue.title;
        const project = await issue.project;
        const issueURL = `https://linear.app/issue/${id}`;
        tasks.push({ id, title, issueURL, project });
    }
    return tasks;
}
/**
 * Fetches tasks that are upcoming in the next week.
 * @returns {Promise<Task[]>} An array of upcoming tasks.
 */
async function fetchUpcomingIssues() {
    const me = await linearClient.viewer;
    const upcomingIssues = await me.assignedIssues({
        orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
        filter: {
            state: { type: { in: ["unstarted"] } },
            priority: { lte: 2 },
        },
    });
    const tasks = [];
    for (const issue of upcomingIssues.nodes) {
        const id = issue.identifier;
        const title = issue.title;
        const project = await issue.project;
        const issueURL = `https://linear.app/issue/${id}`;
        tasks.push({ id, title, issueURL, project });
    }
    return tasks;
}
/**
 * Sorts projects alphabetically.
 * @param {{[project: string]: {[status: string]: Task[]}}} data The data to sort.
 * @returns {{[project: string]: {[status: string]: Task[]}}} The sorted data.
 */
function sortProjectsAlphabetically(data) {
    const sortedData = {};
    const projectNames = Object.keys(data).sort((a, b) => {
        if (a === "no project")
            return 1;
        if (b === "no project")
            return -1;
        return a.localeCompare(b);
    });
    for (const projectName of projectNames) {
        sortedData[projectName] = data[projectName];
    }
    return sortedData;
}
/**
 * Fetches data from Linear and structures it.
 * @returns {Promise<StructuredLinearData>} The fetched and structured data.
 */
async function fetchDataFromLinear() {
    try {
        const projects = await fetchMyProjects();
        const tasks = {
            completed: await fetchCompletedIssues(),
            upcoming: await fetchUpcomingIssues(),
        };
        const structuredData = {};
        for (const task of tasks.completed) {
            const projectName = task.project ? task.project.name : "no project";
            if (!structuredData[projectName]) {
                structuredData[projectName] = {};
            }
            if (!structuredData[projectName]["completed"]) {
                structuredData[projectName]["completed"] = [];
            }
            structuredData[projectName]["completed"].push(task);
        }
        for (const task of tasks.upcoming) {
            const projectName = task.project ? task.project.name : "no project";
            if (!structuredData[projectName]) {
                structuredData[projectName] = {};
            }
            if (!structuredData[projectName]["upcoming"]) {
                structuredData[projectName]["upcoming"] = [];
            }
            structuredData[projectName]["upcoming"].push(task);
        }
        const sortedData = sortProjectsAlphabetically(structuredData);
        return { projects, tasks: sortedData };
    }
    catch (error) {
        console.error("Error fetching data from Linear API:", error);
        return { projects: [], tasks: {} };
    }
}
/**
 * Calculates the number of work days remaining between two dates.
 * @param {Date} startDate The start date.
 * @param {Date} targetDate The target date.
 * @returns {number} The number of work days remaining.
 */
function calculateWorkDaysRemaining(startDate, targetDate) {
    const oneDay = 24 * 60 * 60 * 1000; // Number of milliseconds in a day
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const diffDays = Math.round(Math.abs((start.getTime() - target.getTime()) / oneDay));
    const weekendsCount = countWeekends(start, target);
    const workDays = diffDays - weekendsCount;
    return workDays;
}
/**
 * Counts the number of weekends between two dates.
 * @param {Date} startDate The start date.
 * @param {Date} endDate The end date.
 * @returns {number} The number of weekends.
 */
function countWeekends(startDate, endDate) {
    let count = 0;
    const current = new Date(startDate.getTime());
    while (current <= endDate) {
        if (current.getDay() === 0 || current.getDay() === 6) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
}
/**
 * Generates a Markdown report from the structured data.
 * @param {StructuredLinearData} data The structured data.
 * @returns {string} The generated Markdown report.
 */
function generateMarkdownReport(data) {
    let report = "";
    // My Active Projects
    report += "## My Active Projects\n\n";
    for (const project of data.projects) {
        report += `### [${project.name}](${project.url})\n\n`;
        const targetDate = project.targetDate ? new Date(project.targetDate) : null;
        if (targetDate) {
            const remainingWorkDays = project.remainingWorkDays;
            const formattedTargetDate = targetDate.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
            report += `**Target date:** ${formattedTargetDate}\n\n`;
            report += `**Work days remaining:** ${remainingWorkDays}\n\n`;
        }
        else {
            report += "_No target date_\n\n";
        }
    }
    // Completed this week
    report += "## Completed this week (by project)\n\n";
    for (const project in data.tasks) {
        if (data.tasks[project]["completed"]) {
            report += `### ${project}\n\n`;
            for (const task of data.tasks[project]["completed"]) {
                const taskLink = `[${task.id}](${task.issueURL})`;
                report += `- ${taskLink} ${task.title}\n`;
            }
            report += "\n";
        }
    }
    // Upcoming next week
    report += "## Upcoming next week (by project)\n\n";
    for (const project in data.tasks) {
        if (data.tasks[project]["upcoming"]) {
            report += `### ${project}\n\n`;
            for (const task of data.tasks[project]["upcoming"]) {
                const taskLink = `[${task.id}](${task.issueURL})`;
                report += `- ${taskLink} ${task.title}\n`;
            }
            report += "\n";
        }
    }
    return report;
}
/**
 * Generates an HTML report from the structured data.
 * @param {StructuredLinearData} data The structured data.
 * @returns {string} The generated HTML report.
 */
function generateHTMLReport(data) {
    let report = `<!DOCTYPE html><html><head><style>body {font-family: Arial, sans-serif;}h1 {font-size: 24px;margin-bottom: 12px;}h2 {font-size: 18px;margin-bottom: 8px;}h3 {font-size: 14px;margin-bottom: 6px;}p {margin: 4px 0;}</style></head><body>`;
    // My Active Projects
    report += "<h1>My Active Projects</h1>";
    for (const project of data.projects) {
        report += `<h3><a href="${project.url}">${project.name}</a></h3>`;
        const targetDate = project.targetDate ? new Date(project.targetDate) : null;
        if (targetDate) {
            const remainingWorkDays = project.remainingWorkDays;
            const formattedTargetDate = targetDate.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
            report += `<p><strong>Target date:</strong> ${formattedTargetDate}</p>`;
            report += `<p><strong>Work days remaining:</strong> ${remainingWorkDays}</p>`;
        }
        else {
            report += "<p>No target date</p>";
        }
    }
    // Completed this week
    report += "<h1>Completed this week</h1>";
    for (const project in data.tasks) {
        if (data.tasks[project]["completed"]) {
            report += `<h3>${project}</h3>`;
            for (const task of data.tasks[project]["completed"]) {
                const taskLink = `<a href="${task.issueURL}">${task.id}</a>`;
                report += `<p>${taskLink} ${task.title}</p>`;
            }
        }
    }
    // Upcoming next week
    report += "<h1>Upcoming next week</h1>";
    for (const project in data.tasks) {
        if (data.tasks[project]["upcoming"]) {
            report += `<h3>${project}</h3>`;
            for (const task of data.tasks[project]["upcoming"]) {
                const taskLink = `<a href="${task.issueURL}">${task.id}</a>`;
                report += `<p>${taskLink} ${task.title}</p>`;
            }
        }
    }
    report += `
      </body>
    </html>
  `;
    return report;
}
(async () => {
    console.log("Fetching data from Linear...");
    const linearData = await fetchDataFromLinear();
    console.log("Data fetched successfully!");
    console.log("Generating reports...");
    const markdownReport = generateMarkdownReport(linearData);
    const htmlReport = generateHTMLReport(linearData);
    console.log("Reports generated!");
    // Create a directory for the reports
    const desktopPath = path.join(os.homedir(), "Desktop");
    const reportsPath = path.join(SAVE_TO_DESKTOP ? desktopPath : ".", "reports");
    console.log("Saving reports to:", reportsPath);
    // Check if the reports directory exists, if not, create it
    if (!fs.existsSync(reportsPath)) {
        console.log("Reports directory does not exist, creating it...");
        fs.mkdirSync(reportsPath);
    }
    // Set the report file paths
    const htmlReportPath = path.join(reportsPath, "report.html");
    const mdReportPath = path.join(reportsPath, "report.md");
    // Save the HTML report to a file
    fs.writeFile(htmlReportPath, htmlReport, (err) => {
        if (err) {
            console.error("Error saving the report:", err);
            return;
        }
        console.log("HTML report saved successfully!");
    });
    // Save the Markdown report to a file
    fs.writeFile(mdReportPath, markdownReport, (err) => {
        if (err) {
            console.error("Error saving the report:", err);
            return;
        }
        console.log("Markdown report saved successfully!");
    });
})();
