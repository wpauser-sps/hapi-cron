import type Hapi from '@hapi/hapi';
import Hoek from '@hapi/hoek';
import Chalk from 'chalk';
import Parse from 'cron-parser';
import { CronJob } from 'cron';
import Table from 'easy-table';
import PluginPackageJson from '@speechportal/cron/package.json';

interface InvokeFunction {
  (): boolean;
}

interface OnCompleteFunction {
  (): void;
}

interface Jobs {
  name: string;
  time: string;
  timezone: string;
  request: {
    method: string;
    url: string;
    headers?: {
      [key: string]: any;
    };
  };
  invoke?: boolean | InvokeFunction;
  onComplete?: OnCompleteFunction;
}

interface PluginConfig {
  show?: boolean;
  jobs: Jobs[]
}

const internals = {
  trigger: (server, job) => {
    return async () => {
      /* istanbul ignore else  */
      if (!await job.invoke()) {
        server.log(['info', PluginPackageJson.name], `Skipping: ${job.name}`);
        return;
      }

      server.log(['info', PluginPackageJson.name], job.name);

      const res = await server.inject(job.request);

      /* istanbul ignore else  */
      if (job.onComplete) {
        job.onComplete(res.result);
      }
    };
  },
  onPostStart: (jobs) => {
    return () => {
      for (const key of Object.keys(jobs)) {
        jobs[key].start();
      }
    };
  },
  onPreStop: (jobs) => {
    return () => {
      for (const key of Object.keys(jobs)) {
        jobs[key].stop();
      }
    };
  }
};

const PluginRegistration = (server: Hapi.Server, options: PluginConfig): void => {
  const jobs = {};
  const config = [];

  if (!options.jobs || !options.jobs.length) {
    server.log([PluginPackageJson.name], 'No cron jobs provided.');
  } else {
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
      } catch (err) {
        if (err.message === 'Invalid timezone.') {
          Hoek.assert(!err, 'Invalid timezone. See https://momentjs.com/timezone for valid timezones');
        } else {
          Hoek.assert(!err, 'Time is not a cron expression');
        }
      }
    });
  }

  if (options.show) {
    server.events.on('start', () => {
      const t = new Table();

      const table = config.map((job) => {
        return {
          name: job.name,
          nextRun: Parse.parseExpression(job.time).next(),
          cronSchedule: job.time,
          method: job.request.method,
          path: job.request.url,
        }
      }).sort((a, b): any => {
        return a.nextRun.getTime() - b.nextRun.getTime();
      });

      table.forEach((job) => {
        t.cell('name', Chalk.magenta(job.name));
        t.cell('cron schedule', Chalk.red(job.cronSchedule));
        t.cell('next run', Chalk.cyan(job.nextRun.toISOString()));
        t.cell('method', Chalk.green(job.method));
        t.cell('path', Chalk.yellow(job.path));
        t.newRow();
      });

      console.log();
      console.log(Chalk.cyan.underline(`${config.length} cronjobs registered`));
      console.log(t.toString());
    });
  }

  server.expose('jobs', jobs);
  server.ext('onPostStart', internals.onPostStart(jobs));
  server.ext('onPreStop', internals.onPreStop(jobs));
};

const plugin = {
  register: PluginRegistration,
  pkg: PluginPackageJson
}

export { plugin };
