(function(d) {

    var loginButton = d.getElementById('login-with-google');
    var listObjectsButton = d.getElementById('s3listobjects');
    var getObjectButton = d.getElementById('s3getobject');

    var outputArea = d.getElementById('output');

    function listS3Objects() {
        fetch('/api/s3/list', {credentials: 'same-origin'})
            .then(function(response) {
                return response.json();
            })
            .then(function(data) {
                console.log(data);
                outputArea.textContent = JSON.stringify(data, null, 2);
            })
            .catch(function(err) {
                console.error(err)
            });
    }

    function getObject() {

    }
    
    if (loginButton) {
        loginButton.addEventListener('mouseup', function(e) {
            // redirect user to Google authentication endpoint
            e.preventDefault();
            d.location = '/auth/gg/flow';
        });
    }

    if (listObjectsButton) {
        listObjectsButton.addEventListener('mouseup', function(e) {
            e.preventDefault();
            listS3Objects();
        });
    }

    if (getObjectButton) {
        getObjectButton.addEventListener('mouseup', function(e) {
            e.preventDefault();
            getS3Object();
        });
    }

})(document);
