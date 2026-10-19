import type { ToolCallFormLabels } from "../widget/toolCallLabels";
import type { WidgetLabels } from "../widget/types";
import type { TimeAgoLabels } from "../widget/timeAgo";
import type { FeedbackLabels } from "../widget/renderFeedback";
import type { SpeechToTextLabels } from "../widget/speechToText";

export interface UiCatalog {
  form: ToolCallFormLabels;
  widget: Omit<WidgetLabels, "timeAgo">;
  timeAgo: TimeAgoLabels;
  feedback: FeedbackLabels;
  speech: SpeechToTextLabels;
  common: {
    stopButton: string;
    close: string;
    attachFile: string;
    openTitle: string;
    closeTitle: string;

    chat: string;
    welcome: string;
    prompt: string;
    placeholder: string;
    send: string;
    stop: string;
    thinking: string;
    openChat: string;
    openConversation: string;
    collapseConversation: string;
    newMessage: string;
    jumpToLatest: string;
    formSubmitted: string;
    sendFailed: string;
  };
}
