import { AzureFunction, Context } from "@azure/functions";

const INPUT_CONTAINER = process.env["INPUT_CONTAINER"] || "incoming";

const blobStart: AzureFunction = async function (context: Context, inputBlob: Buffer): Promise<void> {
  const name: string = context.bindingData.name;
  const docId = name.replace(/\..+$/, ""); // strip extension
  const starter = (context.bindings as any).starter; // durable client binding

  const instanceId = await starter.startNew("Orchestrator", undefined, {
    docId,
    inputPath: `${name}`,
    inputContainer: INPUT_CONTAINER
  });

  context.log(`Started orchestration with ID = ${instanceId} for blob ${name}`);
};

export default blobStart;
