const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// Using us-east-1 because Claude 3 models are typically available there
const bedrockClient = new BedrockRuntimeClient({
  region: "us-east-1", 
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID_FOR_AI,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_FOR_AI,
  },
});

const extractTasksFromTranscript = async (transcript, employeeNames = []) => {
  const empListStr = Array.isArray(employeeNames) && employeeNames.length > 0
    ? `Available Workspace Employees for assignment: [${employeeNames.join(", ")}]. Try your best to match mentioned assignees to these exact names.`
    : '';

  const systemPrompt = `You are an expert AI Project Manager. Your job is to extract tasks and action items from meeting transcripts or spoken dictation.
Current Date: ${new Date().toISOString().split('T')[0]}
${empListStr}

Extract all distinct tasks from the provided transcript.
For each task, return a JSON object with these EXACT keys:
- title: (string) Short, actionable task title.
- assignee_name: (string) Name of the person the task is assigned to. If unassigned or unclear, use "Unassigned". Match to available workspace employees if possible.
- due_date: (string) ISO date (YYYY-MM-DD) if a deadline is mentioned or implied (e.g. "by next Friday", "tomorrow"). If none, return null.
- kpi: (string) The expected outcome, target, or KPI for the task. If none, return null.
- task_type: (string) Must be one of: "master", "daily", or "weekly". Master tasks are large/project-level. Daily/weekly are regular tasks. Default to "daily" if unsure.

Output ONLY a valid JSON array of these task objects. Do not wrap it in markdown block quotes. Do not add any conversational text.
Example output format:
[
  {
    "title": "Design new homepage",
    "assignee_name": "Rahul",
    "due_date": "2024-05-20",
    "kpi": "Complete Figma mockup",
    "task_type": "master"
  }
]`;

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Here is the meeting transcript:\n\n${transcript}\n\nPlease extract the tasks as a JSON array.`,
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-haiku-20240307-v1:0", // Claude 3 Haiku is very fast and cheap
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content[0].text;
    
    // Safely extract JSON in case AI adds markdown formatting
    let jsonString = content.trim();
    if (jsonString.startsWith("```json")) {
        jsonString = jsonString.split("```json")[1].split("```")[0].trim();
    } else if (jsonString.startsWith("```")) {
        jsonString = jsonString.split("```")[1].split("```")[0].trim();
    }

    const tasks = JSON.parse(jsonString);
    return tasks;
  } catch (error) {
    console.error("AI Extraction Error:", error);
    throw new Error("Failed to extract tasks using AI. " + error.message);
  }
};

module.exports = {
  extractTasksFromTranscript,
};
