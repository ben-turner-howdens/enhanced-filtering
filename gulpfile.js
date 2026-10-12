'use strict';

const fs = require('fs');
const path = require('path');
const gulp = require('gulp');
const { Transform } = require('stream');
const sass = require('gulp-sass')(require('sass'));
const cleanCSS = require('gulp-clean-css');
const terser = require('gulp-terser');

const defaults = {
  sassSrc: './src/sass/**/*.scss',
  jsSrc: ['./src/**/*.js', '!./src/**/*.min.js'],
  cssDest: './dist/css',
  jsDest: './dist/js',
  minCssDest: './dist/mincss',
  minJsDest: './dist/minjs',
  htmlSrc: ['./src/**/*.html', '!./dist/**/*.html', '!./node_modules/**/*.html'],
  preprodDest: './dist/preprod',
  prodDest: './dist/prod',
  inlineCss: './dist/mincss/styles.min.css',
  output: 'body-fragment',
  stripScripts: true,
};

const userConfig = fs.existsSync('./gulp.config.js') ? require(path.resolve('./gulp.config.js')) : {};
const config = { ...defaults, ...userConfig };

function minName() {
  return new Transform({
    objectMode: true,
    transform(file, _, done) {
      file.stem = `${file.stem}.min`;
      done(null, file);
    },
  });
}

function stripHowdensDomain(output) {
  return output.replace(/https:\/\/www\.howdens\.com(?=\/)/gi, '');
}


function getHtmlFiles() {
  return new Promise((resolve, reject) => {
    const files = [];

    gulp
      .src(config.htmlSrc, { allowEmpty: true, read: false })
      .on('data', (file) => files.push(file.path))
      .on('end', () => resolve(files))
      .on('error', reject);
  });
}

function injectCss(html, css) {
  const styleTag = `<style>\n${css}\n</style>`;

  if (config.output === 'body-fragment') {
    const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);

    if (!match) {
      throw new Error('No <body>...</body> block found.');
    }

    const body = config.stripScripts
      ? match[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim()
      : match[1].trim();

    return `${styleTag}\n${body}\n`;
  }

  const cleanHtml = config.stripScripts
    ? html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    : html;

  if (/<\/head>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<\/head>/i, `${styleTag}\n</head>`);
  }

  if (/<body\b[^>]*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<body\b[^>]*>/i, (match) => `${match}\n${styleTag}`);
  }

  return `${styleTag}\n${cleanHtml}`;
}

function styles() {
  return gulp
    .src(config.sassSrc, { allowEmpty: true })
    .pipe(sass().on('error', sass.logError))
    .pipe(gulp.dest(config.cssDest));
}

function minify() {
  return gulp
    .src(path.join(config.cssDest, '**/*.css'), { allowEmpty: true })
    .pipe(cleanCSS({ compatibility: 'ie8' }))
    .pipe(minName())
    .pipe(gulp.dest(config.minCssDest));
}

function scripts() {
  return gulp
    .src(config.jsSrc, { allowEmpty: true })
    .pipe(gulp.dest(config.jsDest));
}

function minjs() {
  return gulp
    .src(config.jsSrc, { allowEmpty: true })
    .pipe(terser())
    .pipe(minName())
    .pipe(gulp.dest(config.minJsDest));
}

async function buildOutput(destination, transformOutput = (output) => output) {
  const htmlFiles = await getHtmlFiles();

  if (!htmlFiles.length) {
    throw new Error(`No HTML files matched ${JSON.stringify(config.htmlSrc)}`);
  }

  if (!fs.existsSync(config.inlineCss)) {
    throw new Error(`CSS file not found: ${config.inlineCss}`);
  }

  const css = fs.readFileSync(config.inlineCss, 'utf8');
  fs.mkdirSync(destination, { recursive: true });

  htmlFiles.forEach((filePath) => {
    const html = fs.readFileSync(filePath, 'utf8');
    const output = transformOutput(injectCss(html, css));
    const outputPath = path.join(destination, path.basename(filePath));
    fs.writeFileSync(outputPath, output);
  });
}

async function inline() {
  return buildOutput(config.preprodDest);
}

async function buildPreprod() {
  return buildOutput(config.preprodDest);
}

async function buildProd() {
  return buildOutput(config.prodDest, stripHowdensDomain);
}

function watch() {
  gulp.watch(config.sassSrc, gulp.series(styles, minify, buildPreprod, buildProd));
  gulp.watch(config.jsSrc, gulp.series(scripts, minjs));
  gulp.watch(config.htmlSrc, gulp.series(buildPreprod, buildProd));
}

const build = gulp.series(styles, minify, scripts, minjs, buildPreprod, buildProd);

exports.styles = styles;
exports.minify = minify;
exports.scripts = scripts;
exports.minjs = minjs;
exports.preprod = buildPreprod;
exports.prod = buildProd;
exports.inline = inline;
exports.build = build;
exports.watch = watch;
exports.default = gulp.series(build, watch);
