// Using raw js instead of ts because of a bug in opencode: Stripping types is currently unsupported for files under node_modules ... src/index.ts failed to load plugin

// One default export for both plugin APIs: opencode V1 (1.18.29+) calls server(),
// V2 calls setup(). The two share helpers but no hooks; see v1.js and v2.js.
import { server } from "./v1.js"
import { setup } from "./v2.js"

export default {
  id: "opencode-litellm-headers",
  setup,
  server,
}
