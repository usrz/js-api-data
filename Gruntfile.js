module.exports = function(grunt) {
  grunt.option('stack', true);

  /* Grunt initialization */
  grunt.initConfig({

    mofu_instrument: {
      all: {
        src: ['src/**/*.js']
      }
    },

    mofu_report: {
      dest: './coverage.html'
    },

    simplemocha: {
      all: {
        src: ['test/**/*.js']
      }
    },

    clean: [ "dist" ]
  });

  /* Load our plugins */
  grunt.loadNpmTasks('mofu');
  grunt.loadNpmTasks('grunt-simple-mocha');


  /* Default tasks */
  grunt.registerTask('default', ['simplemocha']);
  grunt.registerTask('coverage', ['mofu_instrument', 'simplemocha', 'mofu_report']);

};
