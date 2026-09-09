import { App, Button, Form, Input, Modal, Select } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { resolveModelForCapability, useConfigStore, type ModelCapability } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    defaultLabel: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", defaultLabel: "默认生图模型" },
    { capability: "video", modelKey: "videoModel", defaultLabel: "默认视频模型" },
    { capability: "text", modelKey: "textModel", defaultLabel: "默认文本模型" },
    { capability: "audio", modelKey: "audioModel", defaultLabel: "默认音频模型" },
];

export function AppConfigPanel({ showDoneButton = false }: { showDoneButton?: boolean }) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const finishConfig = () => {
        const ready = config.models.length > 0;
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    return (
        <>
            <Form layout="vertical" requiredMark={false}>
                <div className="mb-2 text-sm font-semibold">默认模型</div>
                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {modelGroups.map((group) => (
                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                            <ModelPicker
                                config={config}
                                value={resolveModelForCapability(config, config[group.modelKey], group.capability)}
                                onChange={(model) => updateConfig(group.modelKey, model)}
                                capability={group.capability}
                                fullWidth
                            />
                        </Form.Item>
                    ))}
                </div>
                <div className="mb-2 text-sm font-semibold">生成偏好</div>
                <div className="grid gap-4 md:grid-cols-4">
                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                        <Input
                            type="number"
                            min={1}
                            max={4}
                            value={config.canvasImageCount}
                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                        />
                    </Form.Item>
                    <Form.Item label="默认音频声音" className="mb-4">
                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                    </Form.Item>
                    <Form.Item label="默认音频格式" className="mb-4">
                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                    </Form.Item>
                    <Form.Item label="默认音频语速" className="mb-4">
                        <Input
                            type="number"
                            min={0.25}
                            max={4}
                            step={0.05}
                            value={config.audioSpeed}
                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                        />
                    </Form.Item>
                </div>
                <Form.Item label="默认音频指令" className="mb-4">
                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                </Form.Item>
                <Form.Item label="系统提示词" className="mb-0">
                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                </Form.Item>
            </Form>
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        完成
                    </Button>
                </div>
            ) : null}
        </>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">默认模型和生成偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton />
        </Modal>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(16, Math.floor(Math.abs(Number(value)) || 1))));
}
