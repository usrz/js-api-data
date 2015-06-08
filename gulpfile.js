var gulp = require('gulp');
var mocha = require('gulp-mocha');
var eslint = require('gulp-eslint');
var sequence = require('run-sequence');

gulp.task('eslint', function () {
  return gulp.src(['src/**/*.js', 'test/**/*.js'])
    .pipe(eslint({ configFile: 'eslint.json' }))
    .pipe(eslint.format())
    .pipe(eslint.failOnError());
});

gulp.task('mocha', function () {
  return gulp.src('test/**/*.test.js', {read: false})
    .pipe(mocha({ reporter: 'spec' }));
});

gulp.task('default', function(done) {
  return sequence('mocha', 'eslint', done);
});
