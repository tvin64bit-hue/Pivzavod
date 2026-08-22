/**
 * Единый источник данных сайта. Весь копирайт взят из ТЗ (раздел 4
 * «Постраничная детализация») буквально, без переписывания.
 */

export const site = {
  name: 'Лаборатория живого пива',
  legalName: 'ООО «Лаборатория живого пива»',
  shortName: 'Пивзавод74',
  tagline: 'Крафтовая пивоварня в Челябинске с 2011 года',
  foundedYear: 2011,
  city: 'Челябинск',
} as const;

export const contacts = {
  addressFull: 'Россия, 454048, г. Челябинск, ул. Карпинского, 62, офис 1',
  addressShort: 'г. Челябинск, ул. Карпинского, 62, офис 1',
  postalCode: '454048',
  street: 'ул. Карпинского, 62, офис 1',
  officePhone: { label: '+7 (922) 750-33-01', href: 'tel:+79227503301' },
  officeHours: 'пн–пт 11:00–18:00, сб–вс — выходной',
  transit: 'Маршрутное такси №13К, маршрут «Областная больница — ТК «Синегорье»».',
  photo: 'zdanie.jpg',
} as const;

/** Раздел 4.3.3 — контакты по оптовым закупкам */
export const wholesaleContacts = [
  { name: 'Ройтенберг И.А.', phone: '+7 (908) 085-74-01', href: 'tel:+79080857401' },
  { name: 'Старостин Н.А.', phone: '+7 (950) 726-20-18', href: 'tel:+79507262018' },
] as const;

/** Реквизиты — раздел 4.8 */
export const requisites = [
  {
    org: 'ООО «Лаборатория живого пива»',
    rows: [
      ['ОГРН', '1107451011117'],
      ['ИНН', '7451305093'],
      ['КПП', '745101001'],
      ['ОКПО', '65757381'],
    ],
  },
  {
    org: 'Союз пивоваров Южного Урала',
    rows: [
      ['ОГРН', '1137400000297'],
      ['ИНН', '7451990628'],
      ['КПП', '745101001'],
      ['ОКПО', '21552784'],
      ['ОКАТО', '74501376000'],
      ['ОКТМО', '75701000'],
      ['ОКОГУ', '4210014'],
      ['ОКФС', '16'],
      ['ОКОПФ', '20500'],
    ],
  },
] as const;

/** Главное меню — раздел 4 «Сквозные компоненты» */
export const nav = [
  { label: 'О компании', href: '/o-kompanii' },
  { label: 'Где наше пиво', href: '/gde-kupit' },
  { label: 'Впечатления', href: '/opyt' },
  { label: 'Союз пивоваров', href: '/soyuz-pivovarov' },
  { label: 'Блог', href: '/blog' },
  { label: 'Контакты', href: '/kontakty' },
] as const;

/** Карта сайта для футера — раздел 2 */
export const footerNav = [
  {
    title: 'О компании',
    href: '/o-kompanii',
    items: [
      { label: 'Руководство', href: '/o-kompanii/rukovodstvo' },
      { label: 'Пивоварня', href: '/o-kompanii/pivovarnya' },
      { label: 'Награды', href: '/o-kompanii/nagrady' },
      { label: 'Вакансии', href: '/o-kompanii/vakansii' },
    ],
  },
  {
    title: 'Где наше пиво',
    href: '/gde-kupit',
    items: [
      { label: 'Точки продаж', href: '/gde-kupit/tochki-prodazh' },
      { label: 'Оптовым покупателям', href: '/gde-kupit/opt' },
      { label: 'Осторожно, подделки', href: '/gde-kupit/podlinnost' },
    ],
  },
  {
    title: 'Впечатления',
    href: '/opyt',
    items: [
      { label: 'Дегустационный зал', href: '/opyt/degustacionny-zal' },
      { label: 'Пивные SPA-процедуры', href: '/opyt/spa' },
      { label: 'Пивная на Кирова', href: '/opyt/pivnaya-na-kirova' },
    ],
  },
  {
    title: 'Ещё',
    href: '/blog',
    items: [
      { label: 'Союз пивоваров', href: '/soyuz-pivovarov' },
      { label: 'Блог', href: '/blog' },
      { label: 'Пивной фольклор', href: '/pivnoy-folklor' },
      { label: 'Контакты', href: '/kontakty' },
    ],
  },
] as const;

export const copyright =
  '© 2011–2026 ООО «Лаборатория живого пива». При использовании материалов ссылка на сайт обязательна.';

/** Темы формы заявки — раздел 4 «Форма заявки» */
export const leadTopics = [
  { value: 'tour', label: 'Экскурсия/дегустация' },
  { value: 'wholesale', label: 'Оптовые закупки' },
  { value: 'other', label: 'Другое' },
] as const;

export type LeadTopic = (typeof leadTopics)[number]['value'];

/**
 * Карты. Пока ссылки не заданы, показывается карта Яндекса с поиском по адресу
 * (одна метка). Чтобы вывести все точки продаж на одной карте, соберите её на
 * yandex.ru/map-constructor и вставьте ссылку вида
 * https://yandex.ru/map-widget/v1/?um=constructor%3A…&source=constructor
 * — разметку менять не нужно. Подробности в README.
 */
export const maps = {
  /** Карта со всеми 6 точками продаж — [ЗАПОЛНИТЬ] заказчиком */
  outletsConstructorUrl: null as string | null,
  /** Карта офиса на Карпинского, 62 */
  officeConstructorUrl: null as string | null,
  officeQuery: 'Челябинск, улица Карпинского, 62',
} as const;
