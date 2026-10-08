"use client";

import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import type { Collaborateur } from "../../../../lib/collaborateurs";

export function ArchivageCollaborateur({ collaborateur }: { collaborateur: Collaborateur }) {
  const f = useFormulaire<never>();
  const basculer = () =>
    f.envoyer({ ok: true, charge: { actif: !collaborateur.actif } }, (c) =>
      api.patch(`/api/collaborateurs/${encodeURIComponent(collaborateur.id)}`, c),
    );
  return (
    <>
      {collaborateur.actif ? (
        <BoutonConfirmation
          libelle="Archiver"
          question="Archiver ce collaborateur ? Il ne sera plus proposé pour les affectations."
          libelleConfirmation="Oui, archiver"
          texteChargement="Archivage…"
          action={basculer}
        />
      ) : (
        <Bouton
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Réactivation…"
          onClick={basculer}
        >
          Réactiver
        </Bouton>
      )}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
    </>
  );
}
