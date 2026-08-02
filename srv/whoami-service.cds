service WhoAmIService @(requires: 'authenticated-user') {
    function whoami() returns String;
}
