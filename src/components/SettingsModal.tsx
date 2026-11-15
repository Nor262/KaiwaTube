import React, { useState } from 'react';
import { Settings, Loader2 } from 'lucide-react';
import { DiscoveredModel, fetchGeminiModels } from '../services/gemini';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  geminiModel: string;
  onSave: (apiKey: string, model: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiKey: initialApiKey,
  geminiModel: initialModel,
  onSave,
}) => {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [geminiModel, setGeminiModel] = useState(initialModel);
  const [isDetectingModels, setIsDetectingModels] = useState(false);
  const [detectedModels, setDetectedModels] = useState<DiscoveredModel[]>(() => {
    try {
      const saved = localStorage.getItem('nihongo_gemini_models_cache');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [modelSearchQuery, setModelSearchQuery] = useState('');

  React.useEffect(() => {
    if (isOpen) {
      setApiKey(initialApiKey);
      setGeminiModel(initialModel);
    }
  }, [isOpen, initialApiKey, initialModel]);

  if (!isOpen) return null;

  const handleScanModels = async () => {
    if (!apiKey.trim()) return;
    setIsDetectingModels(true);
    const models = await fetchGeminiModels(apiKey);
    setDetectedModels(models);
    localStorage.setItem('nihongo_gemini_models_cache', JSON.stringify(models));
    setIsDetectingModels(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#1a1b22] border border-[#2f323e] p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#2a2d38] pb-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#e04f3e]" />
            <h2 className="text-base font-bold text-white">
              Cài đặt Trí tuệ Nhân tạo (Gemini AI)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#8b909e] hover:text-white p-1 rounded-lg hover:bg-[#252833]"
          >
            ✕
          </button>
        </div>

        {/* Section 1: API Key */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#f7c873] uppercase tracking-wider block">
            1. Gemini API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Nhập Google Gemini API Key (AIzaSy...)"
            className="w-full bg-[#121316] border border-[#2c2f38] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#e04f3e] focus:ring-1 focus:ring-[#e04f3e]"
          />
          <div className="flex items-center justify-between text-[11px] text-[#8b909e]">
            <span>Tra cứu từ điển và bộ thủ cơ bản hoàn toàn miễn phí không tốn token.</span>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-[#e04f3e] hover:underline"
            >
              Lấy API Key miễn phí ↗
            </a>
          </div>
        </div>

        {/* Section 2: Model Selection */}
        <div className="space-y-3 pt-2 border-t border-[#262832]">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[#f7c873] uppercase tracking-wider block">
              2. Chọn Mô hình (Model)
            </label>
            <button
              type="button"
              disabled={!apiKey || isDetectingModels}
              onClick={handleScanModels}
              className="text-[11px] text-[#e04f3e] hover:text-[#f7c873] disabled:opacity-40 flex items-center gap-1 font-medium transition-colors"
            >
              {isDetectingModels ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-[#e04f3e]" />
                  Đang quét...
                </>
              ) : (
                '⟳ Quét lại từ API Key'
              )}
            </button>
          </div>

          {detectedModels.length > 0 && (
            <div className="relative">
              <input
                type="text"
                value={modelSearchQuery}
                onChange={(e) => setModelSearchQuery(e.target.value)}
                placeholder={`Lọc nhanh trong ${detectedModels.length} models (vd: flash, lite, pro...)`}
                className="w-full bg-[#121316] border border-[#2b2e38] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#7a7f8d] focus:outline-none focus:border-[#e04f3e]"
              />
              {modelSearchQuery && (
                <button
                  type="button"
                  onClick={() => setModelSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8b909e] hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
            {isDetectingModels ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[#9ca1af]">
                <Loader2 className="w-6 h-6 animate-spin text-[#e04f3e]" />
                <span>Đang kết nối API và quét danh sách models...</span>
              </div>
            ) : detectedModels.length > 0 ? (
              detectedModels
                .filter((m) => {
                  if (!modelSearchQuery.trim()) return true;
                  const q = modelSearchQuery.toLowerCase();
                  return (
                    m.id.toLowerCase().includes(q) ||
                    m.name.toLowerCase().includes(q) ||
                    m.description.toLowerCase().includes(q)
                  );
                })
                .map((m) => {
                  const isSelected = geminiModel === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setGeminiModel(m.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-[#252834] border-[#e04f3e] ring-1 ring-[#e04f3e]/40 shadow-sm'
                          : 'bg-[#15161b] border-[#252731] hover:border-[#383c4a]'
                      }`}
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white truncate">
                            {m.name}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#e04f3e]/15 text-[#f7c873]">
                            {m.id}
                          </span>
                        </div>
                        {m.description && (
                          <div className="text-[11px] text-[#8b909e] line-clamp-2 leading-tight">
                            {m.description}
                          </div>
                        )}
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'border-[#e04f3e] bg-[#e04f3e]'
                            : 'border-[#434757]'
                        }`}
                      >
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                  );
                })
            ) : (
              <div className="py-8 text-center text-xs text-[#8b909e] space-y-2 bg-[#15161b] rounded-xl border border-[#252731] p-4">
                <p>Chưa có danh sách model.</p>
                <button
                  type="button"
                  disabled={!apiKey}
                  onClick={handleScanModels}
                  className="px-3 py-1.5 rounded-lg bg-[#e04f3e] text-white text-xs font-semibold hover:bg-[#c94333] disabled:opacity-40"
                >
                  Bấm để quét model từ API Key
                </button>
              </div>
            )}
          </div>

          <div className="pt-1">
            <div className="text-[10px] uppercase font-bold text-[#8b909e] mb-1">
              Hoặc nhập model ID thủ công:
            </div>
            <input
              type="text"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              placeholder="Nhập tên model (vd: gemini-2.5-flash...)"
              className="w-full bg-[#121316] border border-[#282a35] rounded-xl px-3 py-2 text-xs font-mono text-[#f7c873] focus:outline-none focus:border-[#e04f3e]"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[#262832]">
          <span className="text-[11px] text-[#8b909e]">
            Đang chọn: <b className="text-white font-mono">{geminiModel}</b>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-[#23252d] text-xs text-[#a0a4b0] hover:text-white transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={() => {
                onSave(apiKey.trim(), geminiModel.trim() || 'gemini-2.5-flash');
                onClose();
              }}
              className="px-4 py-1.5 rounded-xl bg-[#e04f3e] text-xs font-semibold text-white hover:bg-[#c94333] shadow-md transition-all active:scale-95"
            >
              Lưu cài đặt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
