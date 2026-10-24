import { createLoggerStorage, defineFrameworkIntegration } from "evlog/toolkit";

const { storage } = createLoggerStorage('hapi')
export const integration = defineFrameworkIntegration({ name: 'hapi', storage });
