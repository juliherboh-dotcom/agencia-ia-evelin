import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setConcurrency(2);
// Entorno sandbox: no hay Chrome del sistema, solo el Chromium que ya
// trae preinstalado el contenedor para Playwright -- sin esto el render
// falla buscando un browser que no existe.
Config.setBrowserExecutable(
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"
);
