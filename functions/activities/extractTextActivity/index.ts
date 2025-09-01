import { AzureFunction, Context } from "@azure/functions";
import { extractToJsonlAndPdf } from "../../../shared/docintel";

const activity: AzureFunction = async function (context: Context, input: any): Promise<{ jsonlPath: string; confidencePath: string; searchablePdf?: string }> {
  const { docId, inputPath, inputContainer } = input;
  const res = await extractToJsonlAndPdf(docId, inputContainer, inputPath);
  context.log(`DocIntel JSONL at ${res.jsonlPath}; confidence at ${res.confidencePath}`);
  return { jsonlPath: res.jsonlPath, confidencePath: res.confidencePath, searchablePdf: res.searchablePdf };
};
export default activity;
