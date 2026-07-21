// Firebase Realtime Database のリアルタイム購読・保存に必要な関数を読み込む
import { ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// React のフックを、index.html で読み込まれている UMD 版 React から取り出す
const { useState, useEffect, useMemo, useRef } = React;

// タイムスケジュール専用データを保存する Firebase 上のパス
const LIVE_TIMETABLE_PATH = "liveTimeSchedule";

// 入力前の初期データ
const DEFAULT_TIMETABLE = {
    title: "ライブ タイムスケジュール",
    performanceStart: "18:00",
    performers: [],
    updatedAt: 0,
};

// 空の出演者入力フォームを生成する
function emptyPerformerForm() {
    return {
        name: "",
        songs: "",
        duration: "",
        rehearsal: true,
    };
}

// ID を生成する。crypto.randomUUID が使えない環境では日時と乱数を組み合わせる
function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return "performer-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

// "18:30" のような時刻文字列を、0時からの経過分へ変換する
function timeToMinutes(value) {
    const [hour, minute] = String(value || "00:00").split(":").map(Number);
    return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

// 分数を時刻表示へ変換する。日付をまたぐ場合は「前日」「翌日」を付ける
function minutesToTime(totalMinutes) {
    const dayOffset = Math.floor(totalMinutes / 1440);
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const prefix = dayOffset < 0 ? "前日 " : dayOffset > 0 ? "翌日 " : "";
    return prefix + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

// 配列の要素を指定位置へ移動した新しい配列を返す
function moveItem(list, fromIndex, toIndex) {
    const copied = [...list];
    const [moved] = copied.splice(fromIndex, 1);
    copied.splice(toIndex, 0, moved);
    return copied;
}

// 読み込んだ Firebase データを、安全な形式へ整える
function normalizeTimetable(raw) {
    const source = raw && typeof raw === "object" ? raw : DEFAULT_TIMETABLE;
    const performers = Array.isArray(source.performers)
        ? source.performers.map(item => ({
            id: item.id || makeId(),
            name: String(item.name || ""),
            songs: Math.max(0, Number(item.songs) || 0),
            duration: Math.max(1, Number(item.duration) || Math.max(1, (Number(item.songs) || 1) * 5)),
            rehearsal: item.rehearsal !== false,
        }))
        : [];

    return {
        title: String(source.title || DEFAULT_TIMETABLE.title),
        performanceStart: /^\d{2}:\d{2}$/.test(source.performanceStart || "")
            ? source.performanceStart
            : DEFAULT_TIMETABLE.performanceStart,
        performers,
        updatedAt: Number(source.updatedAt) || 0,
    };
}

// タイムスケジュール画面専用の CSS を注入する
// 既存の style.css を大きく変更せず、この機能だけを独立させるための処理
function ensureTimeScheduleStyles() {
    if (document.getElementById("live-time-schedule-styles")) return;

    const style = document.createElement("style");
    style.id = "live-time-schedule-styles";
    style.textContent = `
        .lts-page {
            min-height: 100vh;
            padding: 18px 14px 40px;
            background: linear-gradient(160deg, #fff8e7 0%, #fffdf8 45%, #f5f3ff 100%);
            color: #2d2d3a;
            font-family: 'M PLUS Rounded 1c', 'Noto Sans JP', sans-serif;
        }
        .lts-shell { max-width: 1180px; margin: 0 auto; }
        .lts-topbar {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
        }
        .lts-title { font-size: 22px; font-weight: 800; letter-spacing: -0.4px; }
        .lts-subtitle { margin-top: 3px; font-size: 12px; color: #8b8b9e; }
        .lts-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .lts-status {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 6px 10px; border-radius: 999px;
            background: rgba(16,185,129,.10); color: #047857;
            border: 1px solid rgba(16,185,129,.22); font-size: 11px; font-weight: 800;
        }
        .lts-status.saving { background: rgba(245,158,11,.10); color: #b45309; border-color: rgba(245,158,11,.25); }
        .lts-status.error { background: rgba(239,68,68,.10); color: #b91c1c; border-color: rgba(239,68,68,.25); }
        .lts-card {
            background: rgba(255,255,255,.90); border: 1px solid rgba(255,255,255,.95);
            box-shadow: 0 10px 40px rgba(45,45,58,.09); border-radius: 18px;
        }
        .lts-editor { padding: 18px; margin-bottom: 16px; }
        .lts-settings-grid {
            display: grid; grid-template-columns: minmax(220px, 1fr) 170px;
            gap: 12px; margin-bottom: 14px;
        }
        .lts-form-grid {
            display: grid; grid-template-columns: minmax(180px, 1.6fr) 120px 140px 160px auto;
            gap: 10px; align-items: end;
        }
        .lts-label { display: block; margin-bottom: 5px; font-size: 11px; font-weight: 800; color: #8b8b9e; }
        .lts-input, .lts-select {
            width: 100%; min-height: 40px; padding: 9px 11px;
            border-radius: 10px; border: 1.5px solid rgba(245,158,11,.22);
            background: rgba(255,251,235,.65); color: #2d2d3a;
            font: inherit; font-size: 13px; outline: none;
        }
        .lts-input:focus, .lts-select:focus {
            border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.12);
        }
        .lts-checkbox-row {
            min-height: 40px; display: flex; align-items: center; gap: 8px;
            padding: 0 10px; border-radius: 10px; border: 1.5px solid rgba(245,158,11,.22);
            background: rgba(255,251,235,.65); font-size: 12px; font-weight: 700;
        }
        .lts-btn {
            border: 0; border-radius: 10px; padding: 10px 15px; cursor: pointer;
            font: inherit; font-size: 12px; font-weight: 800; white-space: nowrap;
            transition: transform .15s, box-shadow .15s, opacity .15s;
        }
        .lts-btn:hover { transform: translateY(-1px); }
        .lts-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
        .lts-btn-main { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; box-shadow: 0 4px 14px rgba(245,158,11,.28); }
        .lts-btn-purple { background: linear-gradient(135deg, #6c63ff, #a855f7); color: white; box-shadow: 0 4px 14px rgba(108,99,255,.25); }
        .lts-btn-ghost { background: rgba(108,99,255,.06); color: #6259e8; border: 1px solid rgba(108,99,255,.18); }
        .lts-btn-danger { background: rgba(239,68,68,.08); color: #dc2626; border: 1px solid rgba(239,68,68,.18); }
        .lts-help { margin-top: 9px; color: #9ca3af; font-size: 11px; line-height: 1.6; }
        .lts-board { padding: 20px; overflow: hidden; }
        .lts-board-head {
            display: flex; justify-content: space-between; align-items: flex-end;
            gap: 12px; flex-wrap: wrap; padding-bottom: 15px;
            border-bottom: 1px solid rgba(108,99,255,.10); margin-bottom: 16px;
        }
        .lts-board-title { font-size: 24px; font-weight: 800; }
        .lts-start-label { font-size: 12px; font-weight: 800; color: #6c63ff; }
        .lts-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .lts-column {
            min-width: 0; border-radius: 15px; padding: 14px;
            background: linear-gradient(160deg, rgba(108,99,255,.035), rgba(168,85,247,.025));
            border: 1px solid rgba(108,99,255,.10);
        }
        .lts-column.rehearsal {
            background: linear-gradient(160deg, rgba(16,185,129,.045), rgba(5,150,105,.025));
            border-color: rgba(16,185,129,.13);
        }
        .lts-column-title {
            display: flex; justify-content: space-between; align-items: center;
            gap: 8px; margin-bottom: 10px; font-size: 15px; font-weight: 800;
        }
        .lts-column-note { font-size: 10px; color: #9ca3af; font-weight: 600; }
        .lts-list { display: flex; flex-direction: column; gap: 8px; min-height: 72px; }
        .lts-block {
            display: grid; grid-template-columns: 28px 94px minmax(0,1fr) auto;
            gap: 9px; align-items: center; padding: 10px 11px;
            border-radius: 12px; background: white; border: 1px solid rgba(108,99,255,.12);
            box-shadow: 0 3px 12px rgba(45,45,58,.06); cursor: grab;
            user-select: none; transition: transform .15s, box-shadow .15s, border-color .15s;
        }
        .lts-block:hover { transform: translateY(-1px); box-shadow: 0 7px 18px rgba(45,45,58,.10); border-color: rgba(108,99,255,.25); }
        .lts-block.dragging { opacity: .45; }
        .lts-block.final-act {
            border: 2px solid #f59e0b;
            background: linear-gradient(135deg, #fff7d6, #ffffff);
            box-shadow: 0 7px 22px rgba(245,158,11,.20);
        }
        .lts-order {
            width: 28px; height: 28px; border-radius: 50%;
            display: grid; place-items: center; background: rgba(108,99,255,.09);
            color: #6c63ff; font-size: 12px; font-weight: 800;
        }
        .lts-block.final-act .lts-order { background: #f59e0b; color: white; }
        .lts-time { font-size: 11px; font-weight: 800; line-height: 1.35; color: #6b7280; white-space: nowrap; }
        .lts-name { min-width: 0; font-size: 14px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lts-meta { margin-top: 2px; font-size: 10px; color: #9ca3af; font-weight: 600; }
        .lts-block-actions { display: flex; gap: 4px; }
        .lts-mini {
            border: 0; border-radius: 7px; padding: 5px 7px; cursor: pointer;
            background: rgba(108,99,255,.07); color: #6c63ff; font-size: 10px; font-weight: 800;
        }
        .lts-mini.delete { color: #dc2626; background: rgba(239,68,68,.07); }
        .lts-empty {
            min-height: 70px; display: grid; place-items: center; text-align: center;
            border: 1.5px dashed rgba(108,99,255,.20); border-radius: 12px;
            color: #a3a3b2; font-size: 12px; line-height: 1.6;
        }
        .lts-live-badge {
            display: inline-flex; align-items: center; padding: 3px 8px; margin-left: 7px;
            border-radius: 999px; background: #f59e0b; color: #fff; font-size: 9px; font-weight: 800;
        }
        .lts-updated { margin-top: 13px; text-align: right; color: #b0b0be; font-size: 10px; }
        /* PNG保存中は編集・削除ボタンを隠し、表として自然な幅に整える */
        .lts-board.is-capturing .lts-block-actions { display: none; }
        .lts-board.is-capturing .lts-block { grid-template-columns: 28px 94px minmax(0,1fr); }
        @media (max-width: 900px) {
            .lts-form-grid { grid-template-columns: 1fr 1fr; }
            .lts-form-grid > :first-child { grid-column: 1 / -1; }
            .lts-columns { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
            .lts-page { padding: 12px 8px 28px; }
            .lts-settings-grid, .lts-form-grid { grid-template-columns: 1fr; }
            .lts-editor, .lts-board { padding: 14px; }
            .lts-board-title { font-size: 20px; }
            .lts-block { grid-template-columns: 28px 82px minmax(0,1fr); }
            .lts-block-actions { grid-column: 2 / -1; justify-content: flex-end; }
            .lts-input, .lts-select { font-size: 16px; }
        }
        @media print {
            .lts-page { padding: 0; background: white; }
            .lts-topbar, .lts-editor, .lts-updated { display: none !important; }
            .lts-board { box-shadow: none; border: 0; }
        }
    `;
    document.head.appendChild(style);
}

// タイムスケジュール画面本体
function TimeSchedulePage({ db, onBack, returnLabel = "管理者モードに戻る" }) {
    // 画面上のデータ・入力フォーム・保存状態を管理する
    const [timetable, setTimetable] = useState(DEFAULT_TIMETABLE);
    const [form, setForm] = useState(emptyPerformerForm());
    const [editingId, setEditingId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saveState, setSaveState] = useState("synced");
    const [saveError, setSaveError] = useState("");
    const [capturing, setCapturing] = useState(false);
    const [draggingId, setDraggingId] = useState(null);

    // 画像保存対象となるスケジュール表部分への参照
    const captureRef = useRef(null);

    // ドラッグ元のリスト種別と出演者 ID を保持する
    const dragInfoRef = useRef(null);

    // 初回表示時に、この画面専用の CSS を追加する
    useEffect(() => {
        ensureTimeScheduleStyles();
    }, []);

    // Firebase をリアルタイム購読し、他端末の変更を即時反映する
    useEffect(() => {
        if (!db) return undefined;
        const timetableRef = ref(db, LIVE_TIMETABLE_PATH);

        const unsubscribe = onValue(
            timetableRef,
            snapshot => {
                setTimetable(normalizeTimetable(snapshot.exists() ? snapshot.val() : DEFAULT_TIMETABLE));
                setLoading(false);
                setSaveState("synced");
                setSaveError("");
            },
            error => {
                console.error("タイムスケジュールのリアルタイム読み込みに失敗しました", error);
                setLoading(false);
                setSaveState("error");
                setSaveError("Firebase の読み込み権限を確認してください");
            }
        );

        return unsubscribe;
    }, [db]);

    // 更新内容を Firebase へ保存する共通処理
    // 保存後は onValue の購読処理を通じ、同じ画面を開いている全員へ反映される
    async function persist(nextData) {
        const normalized = normalizeTimetable({
            ...nextData,
            updatedAt: Date.now(),
        });

        setTimetable(normalized);
        setSaveState("saving");
        setSaveError("");

        try {
            await set(ref(db, LIVE_TIMETABLE_PATH), normalized);
            setSaveState("synced");
        } catch (error) {
            console.error("タイムスケジュールの保存に失敗しました", error);
            setSaveState("error");
            setSaveError("保存できませんでした。Firebase の書き込み権限を確認してください");
        }
    }

    // 本番の開始時刻から、各出演者の開始・終了時刻を順番に計算する
    const performanceRows = useMemo(() => {
        let cursor = timeToMinutes(timetable.performanceStart);
        return timetable.performers.map((performer, index) => {
            const start = cursor;
            const end = start + performer.duration;
            cursor = end;
            return { performer, index, start, end };
        });
    }, [timetable.performanceStart, timetable.performers]);

    // リハーサル対象者だけを抽出し、本番とは逆順に並べる
    const rehearsalOrder = useMemo(() => {
        return timetable.performers.filter(item => item.rehearsal).slice().reverse();
    }, [timetable.performers]);

    // 本番開始時刻から逆算し、リハーサルが本番開始直前に終わるよう15分刻みで計算する
    const rehearsalRows = useMemo(() => {
        const performanceStartMinutes = timeToMinutes(timetable.performanceStart);
        let cursor = performanceStartMinutes - rehearsalOrder.length * 15;
        return rehearsalOrder.map((performer, index) => {
            const start = cursor;
            const end = start + 15;
            cursor = end;
            return { performer, index, start, end };
        });
    }, [timetable.performanceStart, rehearsalOrder]);

    // 出演者追加・編集フォームを保存する
    async function handleSubmit(event) {
        event.preventDefault();

        const name = form.name.trim();
        const songs = Math.max(0, Number(form.songs) || 0);
        const enteredDuration = String(form.duration).trim();
        // 使用時間が未入力なら「曲数 × 5分」を使用する。曲数も未入力の場合は最低5分とする
        const duration = enteredDuration === ""
            ? Math.max(5, songs * 5)
            : Math.max(1, Number(enteredDuration) || 1);

        if (!name) {
            window.alert("名前を入力してください。");
            return;
        }
        if (songs <= 0) {
            window.alert("曲数は1以上で入力してください。");
            return;
        }

        let nextPerformers;
        if (editingId) {
            // 編集中の出演者だけを置き換える
            nextPerformers = timetable.performers.map(item => item.id === editingId
                ? { ...item, name, songs, duration, rehearsal: Boolean(form.rehearsal) }
                : item
            );
        } else {
            // 新規出演者は本番順の末尾へ追加する
            nextPerformers = [
                ...timetable.performers,
                { id: makeId(), name, songs, duration, rehearsal: Boolean(form.rehearsal) },
            ];
        }

        await persist({ ...timetable, performers: nextPerformers });
        setForm(emptyPerformerForm());
        setEditingId(null);
    }

    // ブロックの編集内容をフォームへ戻す
    function startEdit(performer) {
        setEditingId(performer.id);
        setForm({
            name: performer.name,
            songs: String(performer.songs),
            duration: String(performer.duration),
            rehearsal: performer.rehearsal,
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // 編集を取り消して新規追加状態へ戻す
    function cancelEdit() {
        setEditingId(null);
        setForm(emptyPerformerForm());
    }

    // 出演者を本番・リハーサルの両方から削除する
    async function removePerformer(performer) {
        if (!window.confirm(`「${performer.name}」を削除しますか？`)) return;
        const nextPerformers = timetable.performers.filter(item => item.id !== performer.id);
        await persist({ ...timetable, performers: nextPerformers });
        if (editingId === performer.id) cancelEdit();
    }

    // ドラッグ開始時に、移動元のリストと出演者を記録する
    function handleDragStart(event, sourceList, performerId) {
        dragInfoRef.current = { sourceList, performerId };
        setDraggingId(performerId);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", performerId);
    }

    // ドラッグ終了時に見た目の状態を戻す
    function handleDragEnd() {
        dragInfoRef.current = null;
        setDraggingId(null);
    }

    // 本番側のブロックを並べ替える
    function reorderPerformance(sourceId, targetId, insertAfter) {
        const sourceIndex = timetable.performers.findIndex(item => item.id === sourceId);
        const targetIndex = timetable.performers.findIndex(item => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

        let destination = targetIndex + (insertAfter ? 1 : 0);
        // 元要素を先に取り除くため、後方へ移動するときは添字を1つ戻す
        if (sourceIndex < destination) destination -= 1;
        const nextPerformers = moveItem(timetable.performers, sourceIndex, destination);
        persist({ ...timetable, performers: nextPerformers });
    }

    // リハーサル側のブロックを並べ替え、本番側へ逆順で反映する
    function reorderRehearsal(sourceId, targetId, insertAfter) {
        const sourceIndex = rehearsalOrder.findIndex(item => item.id === sourceId);
        const targetIndex = rehearsalOrder.findIndex(item => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

        let destination = targetIndex + (insertAfter ? 1 : 0);
        if (sourceIndex < destination) destination -= 1;
        const movedRehearsalOrder = moveItem(rehearsalOrder, sourceIndex, destination);

        // リハーサル順の逆順が本番順になるように変換する
        const replacementPerformanceOrder = [...movedRehearsalOrder].reverse();
        let replacementIndex = 0;
        const nextPerformers = timetable.performers.map(item => {
            // リハーサルなしの出演者は現在位置を維持する
            if (!item.rehearsal) return item;
            return replacementPerformanceOrder[replacementIndex++];
        });

        persist({ ...timetable, performers: nextPerformers });
    }

    // ドロップ位置の上半分・下半分から、対象の前後どちらへ入れるか判定する
    function handleDrop(event, targetList, targetId) {
        event.preventDefault();
        const dragInfo = dragInfoRef.current;
        if (!dragInfo || dragInfo.sourceList !== targetList) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const insertAfter = event.clientY > rect.top + rect.height / 2;

        if (targetList === "performance") {
            reorderPerformance(dragInfo.performerId, targetId, insertAfter);
        } else {
            reorderRehearsal(dragInfo.performerId, targetId, insertAfter);
        }
        handleDragEnd();
    }

    // html2canvas を使って、操作フォームを除いたスケジュール表だけを PNG 保存する
    async function handleImageSave() {
        if (!captureRef.current || !window.html2canvas || capturing) {
            if (!window.html2canvas) window.alert("画像保存ライブラリを読み込めませんでした。");
            return;
        }

        setCapturing(true);
        // 保存画像には編集用ボタンを含めないため、一時的に専用クラスを付ける
        captureRef.current.classList.add("is-capturing");
        // CSSの変更が描画へ反映されてから html2canvas を実行する
        await new Promise(resolve => requestAnimationFrame(resolve));
        try {
            const canvas = await window.html2canvas(captureRef.current, {
                scale: 2,
                backgroundColor: "#ffffff",
                useCORS: true,
                logging: false,
            });
            const link = document.createElement("a");
            link.download = `live-timetable-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
        } catch (error) {
            console.error("画像保存に失敗しました", error);
            window.alert("画像の保存に失敗しました。");
        } finally {
            captureRef.current.classList.remove("is-capturing");
            setCapturing(false);
        }
    }

    // すべての出演者を削除し、開始時刻などは残す
    async function clearAll() {
        if (!window.confirm("出演者ブロックをすべて削除しますか？")) return;
        await persist({ ...timetable, performers: [] });
        cancelEdit();
    }

    // 本番・リハーサル共通のブロック描画処理
    function renderBlock(row, type) {
        const isPerformance = type === "performance";
        const isFinalAct = isPerformance && row.index === performanceRows.length - 1;
        const performer = row.performer;

        return (
            <div
                key={performer.id}
                className={`lts-block ${isFinalAct ? "final-act" : ""} ${draggingId === performer.id ? "dragging" : ""}`}
                draggable
                onDragStart={event => handleDragStart(event, type, performer.id)}
                onDragEnd={handleDragEnd}
                onDragOver={event => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                }}
                onDrop={event => handleDrop(event, type, performer.id)}
                title="ドラッグして順番を変更できます"
            >
                <div className="lts-order">{row.index + 1}</div>
                <div className="lts-time">
                    <div>{minutesToTime(row.start)}</div>
                    <div>〜 {minutesToTime(row.end)}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                    <div className="lts-name">
                        {performer.name}
                        {isFinalAct && <span className="lts-live-badge">トリ</span>}
                    </div>
                    <div className="lts-meta">
                        {isPerformance
                            ? `${performer.songs}曲・${performer.duration}分${performer.rehearsal ? "・リハあり" : "・リハなし"}`
                            : "リハーサル 15分"
                        }
                    </div>
                </div>
                <div className="lts-block-actions" onMouseDown={event => event.stopPropagation()}>
                    <button className="lts-mini" onClick={() => startEdit(performer)}>編集</button>
                    <button className="lts-mini delete" onClick={() => removePerformer(performer)}>削除</button>
                </div>
            </div>
        );
    }

    const updatedLabel = timetable.updatedAt
        ? new Date(timetable.updatedAt).toLocaleString("ja-JP")
        : "未保存";

    return (
        <div className="lts-page">
            <div className="lts-shell">
                <div className="lts-topbar">
                    <div>
                        <div className="lts-title">タイムスケジュール作成</div>
                        <div className="lts-subtitle">変更は Firebase に自動保存され、同じ画面を開いている全員へリアルタイム反映されます。</div>
                    </div>
                    <div className="lts-actions">
                        <span className={`lts-status ${saveState}`}>
                            {saveState === "saving" ? "保存中…" : saveState === "error" ? "同期エラー" : "リアルタイム同期中"}
                        </span>
                        <button className="lts-btn lts-btn-purple" onClick={handleImageSave} disabled={capturing || loading}>
                            {capturing ? "画像作成中…" : "画像として保存"}
                        </button>
                        <button className="lts-btn lts-btn-ghost" onClick={onBack}>{returnLabel}</button>
                    </div>
                </div>

                {saveError && <div className="wbox" style={{ marginBottom: 12 }}>{saveError}</div>}

                <div className="lts-card lts-editor">
                    <div className="lts-settings-grid">
                        <div>
                            <label className="lts-label">スケジュール名</label>
                            <input
                                className="lts-input"
                                value={timetable.title}
                                onChange={event => setTimetable(current => ({ ...current, title: event.target.value }))}
                                onBlur={() => persist(timetable)}
                                placeholder="ライブ タイムスケジュール"
                            />
                        </div>
                        <div>
                            <label className="lts-label">本番開始時刻</label>
                            <input
                                className="lts-input"
                                type="time"
                                value={timetable.performanceStart}
                                onChange={event => {
                                    const next = { ...timetable, performanceStart: event.target.value };
                                    setTimetable(next);
                                    persist(next);
                                }}
                            />
                        </div>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="lts-form-grid">
                            <div>
                                <label className="lts-label">名前</label>
                                <input
                                    className="lts-input"
                                    value={form.name}
                                    onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                                    placeholder="バンド名・出演者名"
                                />
                            </div>
                            <div>
                                <label className="lts-label">曲の数</label>
                                <input
                                    className="lts-input"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={form.songs}
                                    onChange={event => setForm(current => ({ ...current, songs: event.target.value }))}
                                    placeholder="3"
                                />
                            </div>
                            <div>
                                <label className="lts-label">使用時間（分）</label>
                                <input
                                    className="lts-input"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={form.duration}
                                    onChange={event => setForm(current => ({ ...current, duration: event.target.value }))}
                                    placeholder="未入力なら曲数×5"
                                />
                            </div>
                            <label className="lts-checkbox-row">
                                <input
                                    type="checkbox"
                                    checked={form.rehearsal}
                                    onChange={event => setForm(current => ({ ...current, rehearsal: event.target.checked }))}
                                />
                                リハーサル込み
                            </label>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button className="lts-btn lts-btn-main" type="submit">
                                    {editingId ? "変更を保存" : "ブロック追加"}
                                </button>
                                {editingId && (
                                    <button className="lts-btn lts-btn-ghost" type="button" onClick={cancelEdit}>取消</button>
                                )}
                            </div>
                        </div>
                    </form>
                    <div className="lts-help">
                        使用時間を空欄にすると「曲数 × 5分」を自動設定します。リハーサルは対象者のみ表示され、使用時間は一律15分です。
                        ブロックをドラッグすると、本番とリハーサルの逆順関係を保ったまま両方が更新されます。
                    </div>
                    {timetable.performers.length > 0 && (
                        <div style={{ marginTop: 12, textAlign: "right" }}>
                            <button className="lts-btn lts-btn-danger" type="button" onClick={clearAll}>全ブロック削除</button>
                        </div>
                    )}
                </div>

                <div ref={captureRef} className="lts-card lts-board">
                    <div className="lts-board-head">
                        <div>
                            <div className="lts-board-title">{timetable.title || DEFAULT_TIMETABLE.title}</div>
                            <div className="lts-subtitle">本番順とリハーサル順は自動的に逆順で連動します</div>
                        </div>
                        <div className="lts-start-label">本番開始 {timetable.performanceStart}</div>
                    </div>

                    {loading ? (
                        <div className="lts-empty">タイムスケジュールを読み込んでいます…</div>
                    ) : (
                        <div className="lts-columns">
                            <section className="lts-column rehearsal">
                                <div className="lts-column-title">
                                    <span>リハーサル</span>
                                    <span className="lts-column-note">本番と逆順・各15分</span>
                                </div>
                                <div className="lts-list">
                                    {rehearsalRows.length > 0
                                        ? rehearsalRows.map(row => renderBlock(row, "rehearsal"))
                                        : <div className="lts-empty">リハーサル込みの出演者を追加してください</div>
                                    }
                                </div>
                            </section>

                            <section className="lts-column">
                                <div className="lts-column-title">
                                    <span>本番</span>
                                    <span className="lts-column-note">開始時刻から自動計算</span>
                                </div>
                                <div className="lts-list">
                                    {performanceRows.length > 0
                                        ? performanceRows.map(row => renderBlock(row, "performance"))
                                        : <div className="lts-empty">上のフォームから出演者ブロックを追加してください</div>
                                    }
                                </div>
                            </section>
                        </div>
                    )}
                    <div className="lts-updated">最終更新：{updatedLabel}</div>
                </div>
            </div>
        </div>
    );
}

// 既存の script.js から呼び出せるよう、コンポーネントを window に公開する
window.TimeSchedulePage = TimeSchedulePage;
