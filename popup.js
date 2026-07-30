const API_BASE = 'http://localhost:1234/v1';

const modelsSelect = document.getElementById('models');
const promptInput = document.getElementById('prompt');
// const responseDiv = document.getElementById('response');
const sendBtn = document.getElementById('send');
// const copyBtn = document.getElementById('copy');
const loader = document.getElementById('loader');
// const markdownToggle = document.getElementById('markdown');
// доп.
const status = document.getElementById('status');
const select = document.getElementById('viz');
const qtemplate = document.getElementById('qtemplate');


const SYSTEM_PROMPT =
`ROLE: CODE_GENERATOR

OUTPUT_CONSTRAINTS:
- JSON only
- UTF-8
- No markdown
- No comments
- No explanations
- No lists
- No headings
- No code blocks

SCHEMA:
{
  "name": string,
  "code": string
}

TASK:
You must respond with valid JSON only. Do not reveal reasoning or chain-of-thought.
Provide concise, final answers only.

Generate JavaScript function SetupChart(Chart, SeriesNames, PointNames, ChartData),
initializing chart parameters of an ECharts library, where
Chart is an existing ECharts library chart instance,
SeriesNames is the series names, PointNames is the point names,
ChartData is the data matrix (the first index of the matrix is the series number, and the second is the point number).
Use the chart type and additional parameters specified in the user prompt.
`;

let tab;
let full_text;

// Шаблон HTML для вставки
function defaultHtmlTemplate(setup_chart_code) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
<!--    <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>-->
    <script src="https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js"></script>
    <style>
        html,
        body,
        #container {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
        }
    </style>
</head>
<body>
    <div id="container"></div>
    <script>
        let chartDom;
        let myChart;

        function PrepareChartData(data) {
            let DataStatus = false;
            let SerieNames = [];
            let PointNames = [];
            let ChartData = [[]];
            let DimInRowCount = 0;
            let DimInColCount = 0;
            let FirstRowDimIdx = -1;
            let FirstColDimIdx = -1;
            // число измерений в строках/столбцах
            for (let i = 0; i < data.Dimensions.Marks.length; i++) {
                if (data.Dimensions.Marks[i][0] === 'Rows') {
                    DimInRowCount++;
                    if (FirstRowDimIdx == -1) FirstRowDimIdx = i;
                }
                if (data.Dimensions.Marks[i][0] === 'Columns') {
                    DimInColCount++;
                    if (FirstColDimIdx == -1) FirstColDimIdx = i;
                }
            }
            try {
                // обработка кейса с 1 фактом, 1 измерением по строкам и 1 измерением по столбцам
                if (DimInRowCount == 1 && DimInColCount == 1 && data.Facts.Elements.length == 1 && data.Facts.Marks[0][0] == 'Filter') {
                    SerieNames = data.Dimensions.Elements[FirstRowDimIdx];
                    PointNames = data.Dimensions.Elements[FirstColDimIdx];
                    ChartData = Array.from({ length: SerieNames.length }, () => Array(PointNames.length).fill(0));
                    // заполняем данные
                    for (let ElementIdx = 0; ElementIdx < data.Data.Elements.length; ElementIdx++) {
                        //ChartData[data.Data.Elements[ElementIdx][0]][data.Data.Elements[ElementIdx][1]] = +data.Data.Values[ElementIdx].replace(',', '.');
                        const RowIdx = data.Dimensions.ElementKeys[FirstRowDimIdx].indexOf(data.Data.Elements[ElementIdx][FirstRowDimIdx]);
                        const ColIdx = data.Dimensions.ElementKeys[FirstColDimIdx].indexOf(data.Data.Elements[ElementIdx][FirstColDimIdx]);
                        ChartData[RowIdx][ColIdx] = +data.Data.Values[ElementIdx].replace(',', '.');
                    }
                    // признак успеха
                    DataStatus = true;
                }
            } catch (e) {
                console.log(e);
            }
            return {DataStatus, SerieNames, PointNames, ChartData};
        }

        ${setup_chart_code}
        
        window.init = () => {
            console.log('=== Viz Init ===');
            try {
                chartDom = document.getElementById('container');
                myChart = echarts.init(chartDom);
                window.addEventListener('resize', () => myChart.resize());
            } catch (e) {
                console.error('Viz init error:', e);
            }
        };

        window.update = (data) => {
            console.log('=== Viz Update ===');
            try {
                const {DataStatus, SerieNames, PointNames, ChartData} = PrepareChartData(data);
                if (DataStatus) {
                    myChart.clear();
                    SetupChart(myChart, SerieNames, PointNames, ChartData);
                    console.log('=== data ===', data);
                    console.log('=== SerieNames ===', SerieNames);
                    console.log('=== PointNames ===', PointNames);
                    console.log('=== ChartData ===', ChartData);
                }
            } catch (e) {
                console.error('Viz update error:', e);
            }
        };

        //window.init();
        //window.update();

    </script>
</body>
</html>
`;
}

// <|channel|"... is not valid JSON <|channel|>final <|constrain|>JSON<|message|>
// <|channel|>final <|constrain|>JSON<|message|>
function stripMarkdown(md) {
  return md
      .replace('<|channel|>final', '')
      .replace('<|constrain|>JSON', '')
      .replace('<|message|>', '')
      .replace('```json', '')
      .replace('```', '')
      /*// code blocks
      .replace(/```[\s\S]*?```/g, '')
      // inline code
      .replace(/`([^`]+)`/g, '$1')
      // images
      .replace(/!\[.*?\]\(.*?\)/g, '')
      // links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      // bold / italic
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      // headings
      .replace(/^#{1,6}\s+/gm, '')
      // blockquotes
      .replace(/^>\s+/gm, '')
      // lists
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')*/
      .trim();
}


async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}


// Функция, которая выполняется в контексте страницы и возвращает информацию об iframe
function pageGetIframesInfo() {
  try {
    const iframes = Array.from(document.getElementsByTagName('iframe'));
    return iframes.map((f, idx) => {
      let sandbox = f.getAttribute('sandbox');
      let sameOriginAccess = true;
      try {
        const _ = f.contentWindow && f.contentDocument && f.contentDocument.location && f.contentDocument.location.href;
      } catch (e) {
        sameOriginAccess = false;
      }
      return {
        index: idx,
        name: f.name || null,
        id: f.id || null,
        src: f.getAttribute('src') || null,
        sandbox: sandbox,
        width: f.width || f.clientWidth || null,
        height: f.height || f.clientHeight || null,
        sameOriginAccess: sameOriginAccess
      };
    });
  } catch (err) {
    return { error: String(err) };
  }
}

// Замена srcdoc по индексу
function pageReplaceIframeSrcdoc(index, htmlString) {
  try {
    const frames = Array.from(document.getElementsByTagName('iframe'));
    const f = frames[index];
    if (!f) return { ok: false, error: 'iframe not found' };

    const sandbox = f.getAttribute('sandbox') || '';
    const hasAllowScripts = sandbox.includes('allow-scripts');
    const hasAllowSameOrigin = sandbox.includes('allow-same-origin');

    let sameOriginAccess = true;
    try {
      const _ = f.contentWindow && f.contentDocument && f.contentDocument.location && f.contentDocument.location.href;
    } catch (e) {
      sameOriginAccess = false;
    }

    if (!hasAllowScripts || !hasAllowSameOrigin) {
      return { ok: false, error: 'iframe sandbox не содержит both allow-scripts и allow-same-origin' };
    }
    if (!sameOriginAccess) {
      return { ok: false, error: 'iframe — cross-origin или нельзя получить доступ' };
    }

    // Удаляем src чтобы при перезагрузке не подтянулся старый контент
    f.removeAttribute('src');
    f.srcdoc = htmlString;

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}


// отрабатывает на DOMContentLoaded
async function loadModels() {

  // 1. Загрузка списка LLM моделей
  const res = await fetch(`${API_BASE}/models`);
  const data = await res.json();
  //
  data.data.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = model.id;
    modelsSelect.appendChild(opt);
  });

  // 2. Загрузка списка iframes текущей закладки
  tab = await getActiveTab();
  if (!tab) {
    status.textContent = 'Не удалось определить активную вкладку.';
    return;
  }

  // Получаем список iframe через chrome.scripting.executeScript
  const res2 = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageGetIframesInfo
  });

  let infos = [];
  if (res2 && res2[0] && res2[0].result) {
    if (res2[0].result.error) {
      status.textContent = 'Ошибка при чтении iframe на странице: ' + res[0].result.error;
      return;
    }
    infos = res2[0].result;
  } else {
    status.textContent = 'Не удалось получить список iframe.';
    return;
  }

  // Заполним селект
  select.innerHTML = '';
  if (infos.length === 0) {
    select.innerHTML = '<option>iframe не найдены</option>';
    //injectBtn.disabled = true;
    //saveBtn.disabled = true;
    return;
  }

  infos.forEach(info => {
    const opt = document.createElement('option');
    opt.value = info.index;
    let labelParts = [`#${info.index}`];
    if (info.name) labelParts.push(`name="${info.name}"`);
    if (info.id) labelParts.push(`id="${info.id}"`);
    if (info.src) labelParts.push(`src="${info.src}"`);
    if (info.sandbox) labelParts.push(`sandbox="${info.sandbox}"`);
    if (!info.sameOriginAccess) labelParts.push('(no access: cross-origin)');
    opt.textContent = labelParts.join(' — ');
    const sandbox = info.sandbox || '';
    const okSandbox = sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin');
    if (!info.sameOriginAccess || !okSandbox) {
      opt.disabled = true;
    }
    select.appendChild(opt);
  });

  //status.textContent = 'Выберите iframe, в котором sandbox содержит allow-scripts и allow-same-origin.';

}

async function sendPrompt() {
  const model = modelsSelect.value;
  const prompt = promptInput.value.trim();
  if (!prompt) {
    status.textContent = 'Укажите описание диаграммы.';
    return;
  }

  // responseDiv.innerHTML = '';
  loader.classList.remove('hidden');

  let text;

  try {
    status.textContent = 'Начинаем...';

    // 1. Отправка запроса к модели данных
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        //response_format: { type: "json_object" },
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    text = data.choices[0].message.content;

    // if (markdownToggle.checked) {
    //   responseDiv.innerHTML = marked.parse(text);
    // } else {
    //   responseDiv.textContent = text;
    // }

    // удалим лишнее в ответе
    text = stripMarkdown(text)

    // парсим в объект
    const resp = JSON.parse(text);

    // вставим в код сгенерированную функцию
    full_text = defaultHtmlTemplate(resp.code);

    // responseDiv.textContent = full_text;

    // сразу копируем в буфер
    navigator.clipboard.writeText(full_text);

    // 2. Инжект кода в выбранный iframe
    const selectedIndex = Number(select.value);

    // выполняем замену
    const execRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageReplaceIframeSrcdoc,
      args: [selectedIndex, full_text]
    });

    if (execRes && execRes[0] && execRes[0].result) {
      const r = execRes[0].result;
      if (r.ok) {
        status.textContent = 'Успешно: содержимое iframe заменено (srcdoc).';
      } else {
        status.textContent = 'Неизвестный ответ от content script.';
      }
    }

  } catch (e) {
    // responseDiv.textContent = 'Ошибка: ' + e.message + '\n\nИсходный ответ: ' + text;
    status.textContent.textContent = 'Ошибка: ' + e.message;
  } finally {
    loader.classList.add('hidden');
  }
}

// copyBtn.addEventListener('click', () => {
//   navigator.clipboard.writeText(responseDiv.innerText);
// });

qtemplate.addEventListener('change', () => {
  const selectedText = qtemplate.options[qtemplate.selectedIndex].text;
  if (qtemplate.value) {
    promptInput.value = selectedText;
  }
});


sendBtn.addEventListener('click', sendPrompt);
document.addEventListener('DOMContentLoaded', loadModels);
