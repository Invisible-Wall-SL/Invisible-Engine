/**
 * BrowserStack Live cloud phones for the Profiler's New capture: a short list of real devices and the
 * Live integration URL that opens one on a capture link (docs.browserstack.com → Live →
 * "Integration URL parameters"). The URL carries no BrowserStack key: it opens the Live dashboard
 * in the tester's own signed-in tab.
 */

export interface CloudPhone {
	id: string;
	/** BrowserStack Live's `device` name. */
	device: string;
	os: 'android' | 'ios';
	/** An `os_version` BrowserStack Live lists for that device. */
	osVersion: string;
	/** The short name a reading's device label carries. */
	short: string;
}

export const CLOUD_PHONES: readonly CloudPhone[] = [
	{
		id: 's25',
		device: 'Samsung Galaxy S25',
		os: 'android',
		osVersion: '15.0',
		short: 'Galaxy S25',
	},
	{ id: 'pixel9', device: 'Google Pixel 9', os: 'android', osVersion: '15.0', short: 'Pixel 9' },
	{
		id: 'a16',
		device: 'Samsung Galaxy A16 5G',
		os: 'android',
		osVersion: '15.0',
		short: 'Galaxy A16',
	},
	{ id: 'iphone16', device: 'iPhone 16', os: 'ios', osVersion: '18', short: 'iPhone 16' },
	{ id: 'iphone13', device: 'iPhone 13', os: 'ios', osVersion: '18', short: 'iPhone 13' },
];

export const BROWSERSTACK_LIVE_DASHBOARD = 'https://live.browserstack.com/dashboard';

/** The device label a capture session opened for this phone gives its readings. */
export const cloudPhoneLabel = (phone: CloudPhone): string => `BS Live · ${phone.short}`;

/** The phone a device label was made for, if it was made by `cloudPhoneLabel`. */
export const cloudPhoneOfLabel = (label: string | null | undefined): CloudPhone | null =>
	CLOUD_PHONES.find((p) => cloudPhoneLabel(p) === label?.trim()) ?? null;

/** The Live integration URL that starts `phone` on `url` (its parameters after `#`, `&`-joined). */
export function browserStackLiveUrl(phone: CloudPhone, url: string): string {
	const params: [string, string][] = [
		['os', phone.os],
		['os_version', phone.osVersion],
		['device', phone.device],
		['device_browser', phone.os === 'ios' ? 'safari' : 'chrome'],
		['scale_to_fit', 'true'],
		['speed', '1'],
		['url', url],
		['start', 'true'],
	];
	return `${BROWSERSTACK_LIVE_DASHBOARD}#${params
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('&')}`;
}
