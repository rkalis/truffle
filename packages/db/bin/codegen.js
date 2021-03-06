const fs = require("fs");
const path = require("path");
const { generateNamespace } = require("@gql2ts/from-schema");

const { schema } = require("@truffle/db");

const dataModel = generateNamespace(
  "DataModel",
  schema,
  {
    ignoreTypeNameDeclaration: true,
    ignoredTypes: ["Resource", "Named", "Entry"]
  },
  {
    generateInterfaceName: name => name
  }
);

fs.writeFileSync(path.join(__dirname, "..", "types", "schema.d.ts"), dataModel);
