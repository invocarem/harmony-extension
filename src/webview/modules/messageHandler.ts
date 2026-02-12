/**
 * Message handling between webview and extension
 */

import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from "../types";
import {
  addMessage,
  removeTypingIndicator,
  updateLastUserMessageContextSummary,
  updateStageIndicator,
  startStreamingMessage,
  updateStreamingMessage,
  finalizeStreamingMessage,
} from "./ui";
import {
  populateAutocomplete,
  insertFileReference,
  checkForAutocomplete,
} from "./autocomplete";

declare const vscode: {
  postMessage: (message: WebviewToExtensionMessage) => void;
};

const messageInput = document.getElementById(
  "messageInput"
) as HTMLTextAreaElement;

export function handleExtensionMessage(
  message: ExtensionToWebviewMessage
): void {
  console.log(
    "Webview: Received message from extension, command:",
    message.command,
    "intermediate:",
    message.intermediate
  );

  switch (message.command) {
    case "streamingUpdate":
      // Handle streaming update - create or update the streaming message
      console.log(
        "Webview: Streaming update received, text length:",
        message.text?.length || 0,
        "First 50 chars:",
        message.text?.substring(0, 50)
      );
      if (message.text) {
        updateStreamingMessage(message.text);
      } else {
        console.warn(
          "Webview: streamingUpdate received but text is empty/undefined"
        );
      }
      break;
    case "receiveMessage":
      // Handle both intermediate streaming updates and final messages
      if (message.intermediate) {
        // This is an intermediate streaming update using receiveMessage workaround channel
        console.log(
          "Webview: Receiving intermediate streaming update via receiveMessage, length:",
          message.text?.length || 0
        );
        if (message.text) {
          updateStreamingMessage(message.text);
        }
      } else {
        // This is a final message - finalize streaming with complete content
        console.log("Webview: Received final message, finalizing streaming...");
        finalizeStreamingMessage({
          text: message.text,
          reasoning: message.reasoning,
          commentary: message.commentary,
          final: message.final,
          verboseInfo: message.verboseInfo,
        });
        removeTypingIndicator();

        // Don't call addMessage here - finalization already updated the DOM
        // Only update stage indicator lights
        if (message.verboseInfo?.stage) {
          updateStageIndicator(
            message.verboseInfo.stage,
            message.verboseInfo.hasPlan
          );
        }
      }
      break;
    case "updateContext":
      if (message.context) {
        messageInput.value =
          "Context: " + message.context + "\n\n" + messageInput.value;
        messageInput.focus();
      }
      break;
    case "updateContextSummary":
      if (message.contextSummary) {
        updateLastUserMessageContextSummary(message.contextSummary);
      }
      break;
    case "showFileAutocomplete":
      console.log(
        "Webview: Received file list with",
        (message.files || []).length,
        "files"
      );
      populateAutocomplete(message.files || []);
      break;
    case "insertText":
      if (message.text) {
        const cursorPos = messageInput.selectionStart;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter = messageInput.value.substring(cursorPos);

        messageInput.value = textBefore + message.text + textAfter;
        messageInput.focus();
        messageInput.selectionStart = cursorPos + message.text.length;
        messageInput.selectionEnd = cursorPos + message.text.length;

        // Trigger autocomplete check if it's a file reference
        if (message.text.includes("@file")) {
          setTimeout(checkForAutocomplete, 100);
        }
      }
      break;
  }
}
