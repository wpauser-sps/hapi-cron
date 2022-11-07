/*********************************************************************************
 1. Dependencies
 *********************************************************************************/

const Hoek = require('@hapi/hoek');
const Chalk = require('chalk');
const Table = require('easy-table');
const Parse = require('cron-parser');
const CronJob = require('cron').CronJob;
const PluginPackage = require('../package.json');


/*********************************************************************************
  2. Internals
  *********************************************************************************/

const internals = {};

internals.trigger = (server, job) => {

    return async () => {
        /* istanbul ignore else  */
        if (!await job.invoke()) {
            server.log(['info', PluginPackage.name], `Skipping: ${job.name}`);
            return;
        }

        server.log(['info', PluginPackage.name], job.name);

        const res = await server.inject(job.request);

        /* istanbul ignore else  */
        if (job.onComplete) {
            job.onComplete(res.result);
        }
    };
};

internals.onPostStart = (jobs) => {

    return () => {

        for (const key of Object.keys(jobs)) {
            jobs[key].start();
        }
    };
};

internals.onPreStop = (jobs) => {

    return () => {

        for (const key of Object.keys(jobs)) {
            jobs[key].stop();
        }
    };
};


/*********************************************************************************
  3. Exports
  *********************************************************************************/

const PluginRegistration = (server, options) => {

    const jobs = {};
    const config = [];

    if (!options.jobs || !options.jobs.length) {
        server.log([PluginPackage.name], 'No cron jobs provided.');
    }
    else {
        options.jobs.forEach((job) => {

            Hoek.assert(!jobs[job.name], 'Job name has already been defined');
            Hoek.assert(job.name, 'Missing job name');
            Hoek.assert(job.time, 'Missing job time');
            Hoek.assert(job.timezone, 'Missing job time zone');
            Hoek.assert(job.request, 'Missing job request options');
            Hoek.assert(job.request.url, 'Missing job request url');
            Hoek.assert(typeof job.onComplete === 'function' || typeof job.onComplete === 'undefined', 'onComplete value must be a function');

            if (typeof job.invoke === 'undefined') {
                job.invoke = () => true;
            }

            if (typeof job.invoke === 'boolean') {
                const invoke = job.invoke;
                job.invoke = () => invoke;
            }

            Hoek.assert(typeof job.invoke === 'function' || typeof job.onComplete === 'undefined', 'invoke value must be a function or boolean');

            try {
                config.push(job);
                jobs[job.name] = new CronJob(job.time, internals.trigger(server, job), null, false, job.timezone);
            }
            catch (err) {
                if (err.message === 'Invalid timezone.') {
                    Hoek.assert(!err, 'Invalid timezone. See https://momentjs.com/timezone for valid timezones');
                }
                else {
                    Hoek.assert(!err, 'Time is not a cron expression');
                }
            }
        });
    }

    server.expose('jobs', jobs);
    server.ext('onPostStart', internals.onPostStart(jobs));
    server.ext('onPreStop', internals.onPreStop(jobs));

    if (options.show) {
        server.events.on('start', () => {

            const t = new Table();

            config.forEach((job) => {

                t.cell('name', job.name);
                t.cell('next run', Chalk.cyan(Parse.parseExpression(job.time).nextRun().toISOString()));
                t.cell('method', Chalk.green(job.method));
                t.cell('path', Chalk.yellow(job.url));
                t.newRow();
            });

            console.log(t,toString());
        });
    }
};

exports.plugin = {
    register: PluginRegistration,
    pkg: PluginPackage
};
