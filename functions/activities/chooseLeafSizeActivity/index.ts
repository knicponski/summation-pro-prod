import { AzureFunction, Context } from "@azure/functions";
import { chooseLeafSize } from "../../../shared/chunking";

const activity: AzureFunction = async function (context: Context, input: any): Promise<number> {
  return chooseLeafSize(input.nPages as number);
};
export default activity;
