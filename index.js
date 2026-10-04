import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommanderError, Option } from 'commander';

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