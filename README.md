# backend_lab3

CLI для роботи з даними метеостанції.

Встановлення: `npm install`.

| Команда | Що робить |
| --- | --- |
| `node index.js list [-n <count>]` | перелік датчиків |
| `node index.js show <sensor>` | усі дані датчика |
| `node index.js get <sensor> <field>` | значення поля, напр. `data.37.value` |
| `node index.js info <sensor>` | характеристики датчика |
| `node index.js readings <sensor> [-s]` | серія показів, `-s` пропускає відсутні |
| `node index.js stats [sensor] [-p <digits>]` | мінімум, максимум, середнє |

Глобальна опція `-f, --file <path>`: шлях до JSON-файлу (за замовчуванням `data.json` поруч з `index.js`).