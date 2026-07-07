const { extractTasksFromTranscript } = require("../services/aiService");

const extractTasks = async (req, res) => {
  const { transcript } = req.body;

  if (!transcript || transcript.trim().length === 0) {
    return res.status(400).json({ statusCode: 400, message: "Transcript text is required" });
  }

  try {
    const tasks = await extractTasksFromTranscript(transcript);
    res.status(200).json({ statusCode: 200, data: tasks, message: "Tasks extracted successfully" });
  } catch (error) {
    console.error("Controller Error in extractTasks:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to process transcript", error: error.message });
  }
};

module.exports = {
  extractTasks,
};
