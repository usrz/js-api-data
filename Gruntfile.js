module.exports = function(grunt) {
  grunt.option('stack', true);

  /* Grunt initialization */
  grunt.initConfig({

    simplemocha: {
      all: {
        src: ['test/**/*.js']
      }
    },

    clean: [ "dist" ]
  });

  /* Load our plugins */
  grunt.loadNpmTasks('grunt-simple-mocha');


  /* Default tasks */
  grunt.registerTask('default', ['simplemocha']);

};
