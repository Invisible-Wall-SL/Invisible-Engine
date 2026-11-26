/**
 * BrowserStack Live cloud phones for the Profiler's New capture: the real devices Live lists
 * (https://www.browserstack.com/list-of-browsers-and-platforms/live, read 2026-11-25), grouped by
 * brand, and the Live integration URL that opens one on a capture link. The URL carries no
 * BrowserStack key: it opens the Live dashboard in the tester's own signed-in tab.
 *
 * Live's list page shows each model under its brand ("Galaxy S25" under Samsung); the dashboard's
 * `device` is the brand and the model ("Samsung Galaxy S25"). A phone missing here, or a name Live
 * spells differently, goes in by hand through "Other phone…" (`customCloudPhone`).
 */

export type CloudOs = 'android' | 'ios';

export interface CloudPhone {
	id: string;
	/** The picker group it shows under. */
	brand: string;
	/** BrowserStack Live's `device` name. */
	device: string;
	os: CloudOs;
	/** An `os_version` BrowserStack Live lists for that device. */
	osVersion: string;
	/** The model as the label names it (the device name without its brand). */
	model: string;
}

interface BrandRow {
	brand: string;
	/** What the dashboard's device name starts with; '' for Apple's. */
	prefix: string;
	os: CloudOs;
	devices: [model: string, versions: string[]][];
}

const LIVE_DEVICES: BrandRow[] = [
	{
		brand: 'Samsung',
		prefix: 'Samsung',
		os: 'android',
		devices: [
			['Galaxy S26 Ultra', ['16.0']],
			['Galaxy S26', ['16.0']],
			['Galaxy S25 Ultra', ['15.0']],
			['Galaxy S25', ['15.0']],
			['Galaxy S24 Ultra', ['14.0']],
			['Galaxy S24', ['16.0', '14.0']],
			['Galaxy S23 Ultra', ['13.0']],
			['Galaxy S23', ['13.0']],
			['Galaxy S22 Ultra', ['12.0']],
			['Galaxy S22 Plus', ['12.0']],
			['Galaxy S22', ['12.0']],
			['Galaxy S21', ['12.0', '11.0']],
			['Galaxy S20', ['10.0']],
			['Galaxy Z Fold 8 Ultra', ['17.0']],
			['Galaxy Z Fold 7', ['16.0']],
			['Galaxy Z Fold 6', ['14.0']],
			['Galaxy Z Fold 5', ['13.0']],
			['Galaxy A17', ['16.0']],
			['Galaxy A16 5G', ['15.0']],
			['Galaxy A35', ['14.0']],
			['Galaxy A34', ['13.0']],
			['Galaxy M32', ['11.0']],
		],
	},
	{
		brand: 'Google',
		prefix: 'Google',
		os: 'android',
		devices: [
			['Pixel 11 Pro XL', ['17.0']],
			['Pixel 11 Pro', ['17.0']],
			['Pixel 11', ['17.0']],
			['Pixel 10 Pro XL', ['16.0']],
			['Pixel 10 Pro', ['16.0']],
			['Pixel 10', ['16.0']],
			['Pixel 9 Pro XL', ['15.0']],
			['Pixel 9 Pro', ['15.0']],
			['Pixel 9', ['17.0', '15.0']],
			['Pixel 8 Pro', ['14.0']],
			['Pixel 8', ['14.0']],
			['Pixel 7 Pro', ['13.0']],
			['Pixel 7', ['13.0']],
			['Pixel 6', ['12.0']],
		],
	},
	{
		brand: 'Apple iPhone',
		prefix: '',
		os: 'ios',
		devices: [
			['iPhone 18 Pro Max', ['27']],
			['iPhone 18 Pro', ['27.2', '27']],
			['iPhone Duo', ['27.1']],
			['iPhone 17 Pro Max', ['26']],
			['iPhone 17 Pro', ['26']],
			['iPhone 17', ['26']],
			['iPhone 17e', ['26']],
			['iPhone Air', ['26']],
			['iPhone 16 Pro Max', ['27', '18']],
			['iPhone 16 Pro', ['18']],
			['iPhone 16 Plus', ['18']],
			['iPhone 16', ['18']],
			['iPhone 16e', ['18']],
			['iPhone 15 Pro Max', ['26', '17']],
			['iPhone 15 Pro', ['27', '17']],
			['iPhone 15 Plus', ['17']],
			['iPhone 15', ['27', '26', '17']],
			['iPhone 14 Pro Max', ['16']],
			['iPhone 14 Pro', ['26', '16']],
			['iPhone 14 Plus', ['16']],
			['iPhone 14', ['26', '18', '16']],
			['iPhone 13 Pro Max', ['18']],
			['iPhone 13', ['18', '17', '16', '15']],
			['iPhone 12', ['17', '14']],
			['iPhone SE 2022', ['15']],
		],
	},
	{
		brand: 'Xiaomi',
		prefix: 'Xiaomi',
		os: 'android',
		devices: [
			['Redmi Note 15 5G', ['16.0']],
			['Redmi Note 14 Pro 5G', ['15.0']],
			['Redmi Note 13 Pro 5G', ['14.0']],
			['Redmi Note 12 4G', ['13.0']],
			['Redmi Note 12 Pro', ['12.0']],
		],
	},
	{
		brand: 'OnePlus',
		prefix: 'OnePlus',
		os: 'android',
		devices: [
			['15R', ['16.0']],
			['13R', ['15.0']],
			['12R', ['14.0']],
			['11R', ['13.0']],
		],
	},
	{
		brand: 'Motorola',
		prefix: 'Motorola',
		os: 'android',
		devices: [
			['Edge 70 Fusion', ['16.0']],
			['Edge 60 Fusion', ['15.0']],
			['Edge 50 Fusion', ['14.0']],
			['Edge 40 Neo', ['13.0']],
			['Moto G71 5G', ['11.0']],
		],
	},
	{
		brand: 'Vivo',
		prefix: 'Vivo',
		os: 'android',
		devices: [
			['T5x 5G', ['16.0']],
			['T4x 5G', ['15.0']],
			['V30', ['14.0']],
			['Y100', ['13.0']],
			['Y22', ['12.0']],
		],
	},
	{
		brand: 'Oppo',
		prefix: 'Oppo',
		os: 'android',
		devices: [
			['K14x', ['16.0']],
			['F29', ['15.0']],
			['Reno 8T 5G', ['14.0']],
			['A78', ['13.0']],
			['A96', ['12.0']],
		],
	},
	{
		brand: 'Realme',
		prefix: 'Realme',
		os: 'android',
		devices: [
			['P4 Power', ['16.0']],
			['P3', ['15.0']],
			['12 Plus', ['14.0']],
			['11X 5G', ['13.0']],
		],
	},
	{
		brand: 'Android tablets',
		prefix: 'Samsung',
		os: 'android',
		devices: [
			['Galaxy Tab S12 Plus', ['17.0']],
			['Galaxy Tab S11', ['16.0']],
			['Galaxy Tab S10 Plus', ['15.0']],
			['Galaxy Tab A9 Plus', ['14.0']],
			['Galaxy Tab S9', ['13.0']],
			['Galaxy Tab S8', ['12.0']],
		],
	},
	{
		brand: 'Apple iPad',
		prefix: '',
		os: 'ios',
		devices: [
			['iPad Pro 13 2025', ['26']],
			['iPad Pro 13 2024', ['27', '17']],
			['iPad Pro 11 2025', ['26']],
			['iPad Pro 11 2024', ['17']],
			['iPad Pro 11 2022', ['27']],
			['iPad Pro 11 2021', ['18']],
			['iPad Pro 12.9 2022', ['16']],
			['iPad Pro 12.9 2021', ['26', '17']],
			['iPad Air 11 2026', ['26']],
			['iPad Air 13 2025', ['26', '18']],
			['iPad Air 6', ['17']],
			['iPad Air 5', ['26']],
			['iPad 10th', ['27', '16']],
			['iPad 9th', ['18', '15']],
		],
	},
];

const slug = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

export const CLOUD_PHONES: readonly CloudPhone[] = LIVE_DEVICES.flatMap((row) =>
	row.devices.flatMap(([model, versions]) =>
		versions.map((osVersion) => {
			const device = row.prefix ? `${row.prefix} ${model}` : model;
			return {
				id: slug(`${device} ${osVersion}`),
				brand: row.brand,
				device,
				os: row.os,
				osVersion,
				model,
			};
		}),
	),
);

/** The picker's groups, in the list's order. */
export const CLOUD_PHONE_GROUPS: readonly { brand: string; phones: CloudPhone[] }[] =
	LIVE_DEVICES.map((row) => ({
		brand: row.brand,
		phones: CLOUD_PHONES.filter((p) => p.brand === row.brand),
	}));

/** The longest device name "Other phone…" takes: its label must fit a device label (80). */
export const CUSTOM_DEVICE_MAX = 50;

/**
 * A phone typed by hand, exactly as Live names it ("Samsung Galaxy A14", android, "13.0"); null
 * while a field is blank or a name would not fit a label.
 */
export function customCloudPhone(
	device: string,
	os: CloudOs,
	osVersion: string,
): CloudPhone | null {
	const name = device.trim().replace(/\s+/g, ' ');
	const version = osVersion.trim();
	if (!name || name.length > CUSTOM_DEVICE_MAX || name.includes(' · ')) return null;
	if (!/^[0-9][0-9A-Za-z. ]{0,11}$/.test(version)) return null;
	return { id: 'custom', brand: 'Other', device: name, os, osVersion: version, model: name };
}

export const osName = (os: CloudOs): string => (os === 'ios' ? 'iOS' : 'Android');

export const BROWSERSTACK_LIVE_DASHBOARD = 'https://live.browserstack.com/dashboard';

const LABEL_PREFIX = 'BS Live · ';

/** The device label a capture session opened for this phone gives its readings. */
export const cloudPhoneLabel = (phone: CloudPhone): string =>
	`${LABEL_PREFIX}${phone.model} · ${osName(phone.os)} ${phone.osVersion}`;

const LABEL_SHAPE = /^BS Live · (.+) · (Android|iOS) (\S+)$/;

/**
 * The phone a device label was made for, if `cloudPhoneLabel` made it: a listed phone, or the
 * typed one an "Other phone…" label names (the label carries all three of its fields).
 */
export function cloudPhoneOfLabel(label: string | null | undefined): CloudPhone | null {
	const text = label?.trim() ?? '';
	const listed = CLOUD_PHONES.find((p) => cloudPhoneLabel(p) === text);
	if (listed) return listed;
	const m = LABEL_SHAPE.exec(text);
	return m ? customCloudPhone(m[1], m[2] === 'iOS' ? 'ios' : 'android', m[3]) : null;
}

/**
 * The Live integration URL that starts `phone` on `url` (its parameters after `#`, `&`-joined),
 * with the parameters and values BrowserStack's integration-URL page documents
 * (https://www.browserstack.com/docs/live/integration-url-params, read 2026-11-26): `os` is
 * `iOS` or `Android` as written there — a lowercase `ios` made Live drop `device` and `start`
 * and open no phone — and a space is `+`, as in its `os=OS+X` example.
 * `url` must be a capture GO link (`captureGoUrl`): Live may decode the hash before it splits
 * it on `&`, which would cut a game URL's own `&perfsession=…` off; a GO link has no `?` or `&` to cut.
 */
export function browserStackLiveUrl(phone: CloudPhone, url: string): string {
	const params: [string, string][] = [
		['os', osName(phone.os)],
		['os_version', phone.osVersion],
		['device', phone.device],
		['device_browser', phone.os === 'ios' ? 'safari' : 'chrome'],
		['scale_to_fit', 'true'],
		['speed', '1'],
		['url', url],
		['start', 'true'],
	];
	return `${BROWSERSTACK_LIVE_DASHBOARD}#${params
		.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, '+')}`)
		.join('&')}`;
}
