import { defineFrameworkIntegration } from "evlog/toolkit";
import { createLoggerStorage } from "evlog/toolkit/storage";

const { storage } = createLoggerStorage('hapi')
export const integration = defineFrameworkIntegration({ name: 'hapi', storage });
