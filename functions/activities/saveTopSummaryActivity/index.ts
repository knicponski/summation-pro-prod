import { AzureFunction, Context } from "@azure/functions";
import { writeBlob } from "../../../shared/storage";

const OUTPUT_CONTAINER = process.env["OUTPUT_CONTAINER"] || "work";

const activity: AzureFunction = async function (context: Context, input: any): Promise<void> {
  const { docId, summary, levels } = input as { docId: string; summary: string; levels: number };
  const header = `# Top Summary\n\n- Levels: ${levels}\n- Generated: ${new Date().toISOString()}\n\n---\n\n`;
  await writeBlob(OUTPUT_CONTAINER, `${docId}/summaries/top.md`, header + summary + "\n");
};
export default activity;
