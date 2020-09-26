const REPORT_HOST = "nodestats.doctormckay.com";
const REPORT_PATH = "/report.php";

const Crypto = require('crypto');
const OS = require('os');
const HTTPS = require('https');
const QueryString = require('querystring');

var g_StartupTimestamp = Math.floor(Date.now() / 1000);
var g_RegisteredModules = {};
var g_MachineID = getMachineId();

exports.setup = function(packageJson) {
	if (isOptedOut()) {
		return;
	}

	if (g_RegisteredModules[packageJson.name]) {
		return; // already set up
	}

	g_RegisteredModules[packageJson.name] = packageJson;

	if (Object.keys(g_RegisteredModules).length == 1) {
		// we're the first!
		setupReporting();
	}
};

function isOptedOut() {
	return process.env.NODE_MCKAY_STATISTICS_OPT_OUT || global._mckay_statistics_opt_out;
}

function isDebugging() {
	return process.env.NODE_MCKAY_STATISTICS_DEBUG || global._mckay_statistics_debug;
}

function setupReporting() {
	if (isOptedOut()) {
		return;
	}

	// Report stats hourly, and immediately in 10 minutes
	setInterval(reportStats, 1000 * 60 * 60).unref();
	setTimeout(reportStats, 1000 * 60 * 10).unref();

	if (isDebugging()) {
		setTimeout(reportStats, 1000 * 5);
	}
}

function getMachineId() {
	var macs = [];
	var interfaces = OS.networkInterfaces();
	var iface;
	for (var ifaceName in interfaces) {
		if (!interfaces.hasOwnProperty(ifaceName)) {
			continue;
		}

		iface = interfaces[ifaceName];
		iface.forEach(function(virtualInterface) {
			if (virtualInterface.mac != '00:00:00:00:00:00' && macs.indexOf(virtualInterface.mac) == -1) {
				macs.push(virtualInterface.mac);
			}
		});
	}

	macs.sort();
	var hash = Crypto.createHash('sha1');
	hash.update(macs.join(','), 'ascii');
	return hash.digest('hex');
}

function reportStats() {
	if (isOptedOut()) {
		return;
	}

	var cpus = OS.cpus() || [];

	var reporterVersion = require('./package.json').version;
	var machineId = g_MachineID;
	var arch = OS.arch();
	var cpuSpeedMhz = 0;
	var cpuCount = cpus.length;
	var osPlatform = OS.platform();
	var osRelease = OS.release();
	var totalMemory = OS.totalmem();
	var usedMemory = totalMemory - OS.freemem();
	var osUptimeSeconds = Math.floor(OS.uptime());
	var appUptimeSeconds = Math.floor(Date.now() / 1000) - g_StartupTimestamp;

	cpus.forEach(function(cpu) {
		if (cpu.speed > cpuSpeedMhz) {
			cpuSpeedMhz = cpu.speed;
		}
	});

	var module, stats, req;

	for (var moduleName in g_RegisteredModules) {
		module = g_RegisteredModules[moduleName];
		stats = QueryString.stringify({
			"module": module.name,
			"node_version": process.versions.node,
			"module_version": module.version,
			"reporter_version": reporterVersion,
			"machine_id": machineId,
			"arch": arch,
			"cpu_speed_mhz": cpuSpeedMhz,
			"cpu_count": cpuCount,
			"os_platform": osPlatform,
			"os_release": osRelease,
			"used_memory": usedMemory,
			"total_memory": totalMemory,
			"os_uptime_seconds": osUptimeSeconds,
			"app_uptime_seconds": appUptimeSeconds
		});

		req = HTTPS.request({
			"method": "POST",
			"hostname": REPORT_HOST,
			"path": REPORT_PATH,
			"headers": {
				"Content-Type": "application/x-www-form-urlencoded",
				"Content-Length": Buffer.byteLength(stats),
				"User-Agent": "node/" + process.versions.node + " stats-reporter/" + reporterVersion
			}
		}, function(res) {
			res.on('data', function(chunk) {
				if (isDebugging() && chunk.length > 0) {
					console.log(chunk.toString('ascii'));
				}
			});

			res.on('error', noop);

			if (isDebugging()) {
				console.log("==================================================");
				console.log("Stats reported for " + this.module.name + "@" + this.module.version + ": " + res.statusCode);
				console.log(this.stats);
				console.log("==================================================");
			}
		}.bind({"module": module, "stats": stats}));

		req.on('error', noop);
		req.end(stats);
	}
}

function noop() {
	// nothing
}
