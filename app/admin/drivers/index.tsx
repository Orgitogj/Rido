import WebOnly from "@/components/admin/WebOnly";

export default process.env.EXPO_OS === "web"
  ? require("@/components/admin/console/DriverQueue").default
  : WebOnly;
