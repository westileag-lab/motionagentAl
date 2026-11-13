const video = document.getElementById('webcam');
const canvas = document.getElementById('output-canvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status-text');
const colorPreview = document.getElementById('registered-color-preview');

// 발급받은 텔레그램 정보 적용 완료
const TG_BOT_TOKEN = "9226819865:AAEFeVgJBpWUF1ApSRbHOyPXodL4PmXhguo";
const TG_CHAT_ID = "-1004351985095";

let model;
let currentMode = 1; 
let registeredColor = null; 
let lastAlertTime = 0;
const ALERT_COOLDOWN = 5000; 
const COLOR_THRESHOLD = 60;  

function setMode(mode) {
    currentMode = mode;
    document.getElementById('btn-mode1').className = (mode === 1) ? 'active' : '';
    document.getElementById('btn-mode2').className = (mode === 2) ? 'active' : '';
    document.getElementById('btn-mode3').className = (mode === 3) ? 'active' : '';
    statusText.innerText = `모드 ${mode} 활성화됨`;
}

async function setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    return new Promise(resolve => { video.onloadedmetadata = () => resolve(video); });
}

async function main() {
    await setupCamera();
    video.play();
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    statusText.innerText = "객체 탐지 모델 로딩 중...";
    model = await cocoSsd.load(); 
    statusText.innerText = "1. 실내 관제 모드 구동 중";
    detectFrame();
}

async function detectFrame() {
    const predictions = await model.detect(video);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let persons = [];
    let vehicles = [];

    predictions.forEach(p => {
        const [x, y, w, h] = p.bbox;
        ctx.lineWidth = 2;

        if (currentMode === 1 && p.class === 'person') {
            ctx.strokeStyle = '#00FF00'; ctx.strokeRect(x, y, w, h);
            const cropY = y + h * 0.2, cropH = h * 0.4;
            ctx.strokeStyle = '#FF0000'; ctx.strokeRect(x, cropY, w, cropH);
            
            if (registeredColor) {
                const avgColor = getAverageColor(x, cropY, w, cropH);
                if (compareColors(avgColor, registeredColor)) triggerAlert("지정된 대상이 감지되었습니다.");
            }
        } 
        else if (currentMode === 2 && (p.class === 'car' || p.class === 'truck')) {
            ctx.strokeStyle = '#FFFF00'; ctx.strokeRect(x, y, w, h);
            const avgColor = getAverageColor(x, y, w, h);
            
            // 흰색 판별 (R,G,B 값이 모두 180 이상일 때)
            if (avgColor.r > 180 && avgColor.g > 180 && avgColor.b > 180) {
                ctx.strokeStyle = '#FF0000'; ctx.strokeRect(x, y, w, h);
                triggerAlert("야간 관제, 지정 차량 감지", true);
            }
        }
        else if (currentMode === 3) {
            if (p.class === 'person') persons.push(p.bbox);
            if (p.class === 'car' || p.class === 'truck') vehicles.push(p.bbox);
        }
    });

    if (currentMode === 3 && persons.length > 0 && vehicles.length > 0) {
        for (let p of persons) {
            for (let v of vehicles) {
                if (checkOverlap(p, v)) {
                    ctx.strokeStyle = '#FF0000'; 
                    ctx.strokeRect(p[0], p[1], p[2], p[3]);
                    triggerAlert("차량 주변 미확인 인원 접근 주의", true); // 차량 털이범 모드에서도 텔레그램 전송 켜기
                }
            }
        }
    }
    requestAnimationFrame(detectFrame);
}

function checkOverlap(box1, box2) {
    return !(box1[0] > box2[0] + box2[2] || 
             box1[0] + box1[2] < box2[0] || 
             box1[1] > box2[1] + box2[3] || 
             box1[1] + box1[3] < box2[1]);
}

function getAverageColor(x, y, w, h) {
    const safeX = Math.max(0, Math.min(x, canvas.width - 1));
    const safeY = Math.max(0, Math.min(y, canvas.height - 1));
    const safeW = Math.min(w, canvas.width - safeX);
    const safeH = Math.min(h, canvas.height - safeY);
    if (safeW <= 0 || safeH <= 0) return { r: 0, g: 0, b: 0 };

    const data = ctx.getImageData(safeX, safeY, safeW, safeH).data;
    let r = 0, g = 0, b = 0, count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
    return { r: Math.floor(r / count), g: Math.floor(g / count), b: Math.floor(b / count) };
}

function compareColors(c1, c2) {
    return Math.sqrt(Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2)) < COLOR_THRESHOLD;
}

function triggerAlert(message, sendTelegram = false) {
    const now = Date.now();
    if (now - lastAlertTime > ALERT_COOLDOWN) {
        lastAlertTime = now;
        statusText.innerText = `🚨 경고: ${message}`;
        
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = "ko-KR";
        window.speechSynthesis.speak(utterance);
        
        if (sendTelegram) {
            console.log("텔레그램 전송 시도 중..."); // 로그 추가
            canvas.toBlob((blob) => {
                const formData = new FormData();
                formData.append('chat_id', TG_CHAT_ID);
                formData.append('photo', blob, 'capture.jpg'); 
                formData.append('caption', `🚨 ${message}`);

                fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                })
                .then(response => {
                    if(response.ok) {
                        console.log("텔레그램 캡처 이미지 전송 성공");
                    } else {
                        console.error("텔레그램 전송 실패. 응답 상태:", response.status);
                    }
                })
                .catch(e => console.error("텔레그램 전송 실패(네트워크 오류):", e));
            }, 'image/jpeg', 0.8);
        }
        
        setTimeout(() => { statusText.innerText = `모드 ${currentMode} 활성화됨`; }, 3000);
    }
}

document.getElementById('register-btn').addEventListener('click', async () => {
    if (currentMode !== 1) { alert("색 등록은 1번 실내 모드에서만 가능합니다."); return; }
    const predictions = await model.detect(video);
    for (let p of predictions) {
        if (p.class === 'person') {
            const [x, y, w, h] = p.bbox;
            registeredColor = getAverageColor(x, y + h * 0.2, w, h * 0.4);
            colorPreview.style.backgroundColor = `rgb(${registeredColor.r}, ${registeredColor.g}, ${registeredColor.b})`;
            statusText.innerText = "색상 기준점 등록 완료";
            return;
        }
    }
    alert("사람이 감지되지 않았습니다.");
});

main();