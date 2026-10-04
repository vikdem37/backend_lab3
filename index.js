import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';

const DEFAULT_FILE = join(import.meta.dirname, 'data.json');

// Версію беремо з package.json, щоб не дублювати її в коді.
const { version } = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'));

const EXIT_DATA_ERROR = 1
const EXIT_USAGE_ERROR = 2;

// показуємо лише повідомлення, без стеку викликів.
class AppError extends Error {}

function loadData(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    const reasons = {
      ENOENT: 'файл не знайдено',
      EISDIR: 'вказано теку, а не файл',
      EACCES: 'немає дозволу на читання файлу',
    };
    throw new AppError(`${reasons[err.code] ?? 'не вдалося прочитати файл'}: ${file}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // Node.js повідомляє позицію англійською: "... (line 5 column 3)".
    const pos = err.message.match(/line (\d+) column (\d+)/);
    const where = pos ? ` (рядок ${pos[1]}, стовпець ${pos[2]})` : '';
    throw new AppError(`файл ${file} містить некоректний JSON${where}`);
  }

  if (!Array.isArray(data?.sensors)) {
    throw new AppError(`у файлі ${file} немає масиву "sensors" — це не дані метеостанції`);
  }
  return data;
}

// --help і --version працюють навіть без файлу.
function getData(command) {
  return loadData(command.optsWithGlobals().file);
}

const HELP_TITLES = {
  'Usage:': 'Використання:',
  'Arguments:': 'Аргументи:',
  'Options:': 'Опції:',
  'Global Options:': 'Глобальні опції:',
  'Commands:': 'Команди:',
};

// q — значення в лапках з англійського повідомлення commander.
const USAGE_ERRORS = {
  'commander.unknownCommand': (q) => `невідома команда «${q[0]}»`,
  'commander.unknownOption': (q) => `невідома опція «${q[0]}»`,
  'commander.missingArgument': (q) => `пропущено обов'язковий аргумент <${q[0]}>`,
  'commander.optionMissingArgument': (q) => `не вказано значення опції ${q[0]}`,
  'commander.excessArguments': (q) => `забагато аргументів для команди ${q[0]}`,
  'commander.invalidArgument': (q, reason) => `некоректне значення опції ${q[0]}: ${reason}`,
};

function translateUsageError(err) {
  const quoted = [...err.message.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const reason = err.message.split('is invalid. ')[1];
  const translate = USAGE_ERRORS[err.code];
  let text = translate ? translate(quoted, reason) : 'неправильний виклик програми';
  const suggestion = err.message.match(/Did you mean (?:one of )?(.+)\?/)?.[1];
  if (suggestion) text += `. Можливо, ви мали на увазі: ${suggestion}?`;
  return text;
}

const program = new Command();

// Ці налаштування успадковують усі команди, тому вони задаються до створення команд.
program
  .name('meteo')
  .description('Перегляд даних метеостанції: датчики, їхні покази та статистика')
  .version(version, '-V, --version', 'показати версію програми')
  .helpOption('-h, --help', 'показати довідку')
  .helpCommand('help [command]', 'показати довідку для команди')
  .addOption(
    new Option('-f, --file <path>', 'шлях до JSON-файлу з даними метеостанції')
      .default(DEFAULT_FILE, 'data.json поруч з index.js'),
  )
  .configureHelp({
    showGlobalOptions: true,
    styleTitle: (title) => HELP_TITLES[title] ?? title,
    optionDescription: (option) =>
      option.defaultValue === undefined
        ? option.description
        : `${option.description} (за замовчуванням: ${option.defaultValueDescription ?? option.defaultValue})`,
  })
  .configureOutput({ outputError: () => {} }) // англійське повідомлення не друкуємо
  .exitOverride(); // замість process.exit() commander кидає CommanderError

// Повертає парсер для commander: рядок → ціле число в межах [min, max].
function intParser(min, max = Infinity) {
  return (value) => {
    const number = /^\d+$/.test(value) ? Number(value) : NaN;
    if (Number.isNaN(number) || number < min || number > max) {
      const range = max === Infinity ? `не менше ${min}` : `від ${min} до ${max}`;
      throw new InvalidArgumentError(`очікується ціле число ${range}, отримано «${value}»`);
    }
    return number;
  };
}

function isMissing(reading) {
  return typeof reading.value !== 'number';
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(headers));
  rows.forEach((row) => console.log(line(row)));
}

program
  .command('list')
  .description('показати перелік датчиків станції')
  .option('-n, --limit <count>', 'показати не більше вказаної кількості датчиків', intParser(1))
  .action((options, command) => {
    const data = getData(command);
    const station = data.station ?? {};
    const coords = station.location ? ` (${station.location.latitude}, ${station.location.longitude})` : '';
    console.log(`Станція ${station.name ?? 'без назви'}${coords}, дата ${data.day ?? 'не вказана'}\n`);

    const sensors = data.sensors.slice(0, options.limit);
    const rows = sensors.map((s) => {
      const readings = s.data ?? [];
      return [s.id, s.name, s.interval_minutes, readings.length, readings.filter(isMissing).length];
    });
    printTable(['ID', 'Назва', 'Інтервал, хв', 'Показів', 'Відсутніх'], rows);
    console.log(`\nПоказано ${sensors.length} з ${data.sensors.length}`);
  });

function findSensor(data, ref) {
  const byId = /^\d+$/.test(ref);
  const found = data.sensors.filter((s) => (byId ? s.id === Number(ref) : s.name === ref));
  if (found.length === 0) {
    const names = data.sensors.map((s) => s.name).join(', ');
    throw new AppError(`датчик «${ref}» не знайдено. Доступні: ${names}`);
  }
  if (found.length > 1) {
    throw new AppError(`кілька датчиків мають id ${ref} — вкажіть назву датчика`);
  }
  return found[0];
}

program
  .command('show')
  .description('показати всі дані одного датчика')
  .argument('<sensor>', 'id або назва датчика')
  .action((ref, options, command) => {
    const sensor = findSensor(getData(command), ref);
    console.log(JSON.stringify(sensor, null, 2));
  });

// "data[8].value" і "data.8.value" → ['data', '8', 'value']
function parseFieldPath(fieldPath) {
  const keys = fieldPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (keys.includes('')) {
    throw new AppError(`некоректний шлях до поля: «${fieldPath}»`);
  }
  return keys;
}

function getField(object, keys, fieldPath) {
  let current = object;
  for (const key of keys) {
    const exists = Array.isArray(current)
      ? /^\d+$/.test(key) && Number(key) < current.length
      : current !== null && typeof current === 'object' && Object.hasOwn(current, key);
    if (!exists) {
      throw new AppError(`поле «${fieldPath}» не існує (немає «${key}»)`);
    }
    current = current[key];
  }
  return current;
}

program
  .command('get')
  .description('показати значення окремого поля датчика, зокрема вкладеного')
  .argument('<sensor>', 'id або назва датчика')
  .argument('<field>', 'шлях до поля через крапку, напр. interval_minutes або data.8.value')
  .action((ref, fieldPath, options, command) => {
    const sensor = findSensor(getData(command), ref);
    const value = getField(sensor, parseFieldPath(fieldPath), fieldPath);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  });

program
  .command('info')
  .description('показати характеристики датчика')
  .argument('<sensor>', 'id або назва датчика')
  .action((ref, options, command) => {
    const sensor = findSensor(getData(command), ref);
    const readings = sensor.data ?? [];
    const missing = readings.filter(isMissing).length;
    const rows = [
      ['Назва', sensor.name],
      ['Ідентифікатор', sensor.id],
      ['Тип', sensor.type ?? 'не вказано'],
      ['Одиниці виміру', sensor.unit ?? 'не вказано'],
      ['Інтервал вимірювань', `${sensor.interval_minutes} хв`],
      ['Кількість показів', `${readings.length} (наявних ${readings.length - missing}, відсутніх ${missing})`],
      ['Період', readings.length ? `${readings[0].time} – ${readings.at(-1).time}` : 'немає показів'],
    ];
    rows.forEach(([label, value]) => console.log(`${`${label}:`.padEnd(22)}${value}`));
  });

program
.command('readings')
.description('показати серію показів датчика')
.argument('<sensor>', 'id або назва датчика')
.option('-s, --skip-missing', 'не показувати відсутні покази')
.action((ref, options, command) => {
  const sensor = findSensor(getData(command), ref);
  const all = sensor.data ?? [];
  const shown = options.skipMissing ? all.filter((r) => !isMissing(r)) : all;
  const unit = sensor.unit ? ` ${sensor.unit}` : '';

  console.log(`Покази датчика ${sensor.name}:`);
  shown.forEach((r) => {
    const value = isMissing(r) ? '   немає даних' : `${String(r.value).padStart(6)}${unit}`;
    console.log(`  ${r.time}  ${value}`);
  });
  console.log(`Показано ${shown.length} з ${all.length}`);
});

// Рахує статистику лише за наявними показами; null — якщо жодного немає.
function computeStats(readings) {
  const present = readings.filter((r) => !isMissing(r));
  if (present.length === 0) return null;

  let min = present[0];
  let max = present[0];
  let sum = 0;
  for (const r of present) {
    if (r.value < min.value) min = r;
    if (r.value > max.value) max = r;
    sum += r.value;
  }
  return { min, max, avg: sum / present.length, used: present.length, total: readings.length };
}

program
  .command('stats')
  .description('показати мінімум, максимум і середнє без урахування відсутніх показів')
  .argument('[sensor]', 'id або назва датчика; якщо не вказано — усі датчики')
  .option('-p, --precision <digits>', 'знаків після коми для середнього', intParser(0, 10), 2)
  .action((ref, options, command) => {
    const data = getData(command);
    const sensors = ref === undefined ? data.sensors : [findSensor(data, ref)];

    for (const sensor of sensors) {
      const unit = sensor.unit ? ` ${sensor.unit}` : '';
      const stats = computeStats(sensor.data ?? []);
      console.log(`${sensor.name}:`);
      if (!stats) {
        console.log('  немає жодного наявного показу, статистику обчислити неможливо');
        continue;
      }
      console.log(`  мінімум:  ${stats.min.value}${unit} (о ${stats.min.time})`);
      console.log(`  максимум: ${stats.max.value}${unit} (о ${stats.max.time})`);
      console.log(`  середнє:  ${stats.avg.toFixed(options.precision)}${unit}`);
      console.log(`  враховано ${stats.used} з ${stats.total} показів`);
    }
  });

try {
  program.parse();
} catch (err) {
  if (err instanceof CommanderError) {
    // --help і --version теж завершуються через CommanderError, але з кодом 0.
    // Код commander.help — довідка вже показана, бо не вказано команду.
    if (err.exitCode !== 0 && err.code !== 'commander.help') {
      console.error(`Помилка: ${translateUsageError(err)}`);
      console.error('Довідка: node index.js --help');
    }
    process.exitCode = err.exitCode === 0 ? 0 : EXIT_USAGE_ERROR;
  } else if (err instanceof AppError) {
    console.error(`Помилка: ${err.message}`);
    process.exitCode = EXIT_DATA_ERROR;
  } else {
    console.error(`Неочікувана помилка: ${err.message}`);
    process.exitCode = EXIT_DATA_ERROR;
  }
}