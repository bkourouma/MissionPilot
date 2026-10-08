"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../components/ui/Champ";
import { api } from "../../../../../lib/api";
import { CATEGORIE_LIBELLES, type Debours } from "../../../../../lib/debours";
import type { Echeance } from "../../../../../lib/echeancier";
import { messageFacture, validerCreationFacture } from "../../../../../lib/factures";
import { formaterDate, formaterMontantMineur, type Devise } from "../../../../../lib/format";

export interface CreationFactureProps {
  missionId: string;
  devise: Devise;
  /** Échéances « à facturer » non rattachées à une facture en cours. */
  echeances: Echeance[];
  /** Débours refacturables validés, pas encore facturés. */
  debours: Debours[];
}

/**
 * Brouillon de facture depuis des échéances et des débours (FIN-07). Les montants, la TVA et
 * la retenue sont calculés par le serveur à la création ; l'écran de la facture les affiche.
 */
export function CreationFacture({ missionId, devise, echeances, debours }: CreationFactureProps) {
  const router = useRouter();
  const [echeanceIds, setEcheanceIds] = useState<string[]>([]);
  const [deboursIds, setDeboursIds] = useState<string[]>([]);
  const [objet, setObjet] = useState("");
  const f = useFormulaire<"elements" | "objet">();
  const basculer = (liste: string[], id: string, coche: boolean) =>
    coche ? [...liste, id] : liste.filter((x) => x !== id);

  if (echeances.length === 0 && debours.length === 0) {
    return (
      <p className="mp-texte-doux">
        Rien à facturer : marquez une échéance « à facturer » dans l&apos;échéancier, ou faites
        valider des débours refacturables.
      </p>
    );
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCreationFacture({ echeance_ids: echeanceIds, debours_ids: deboursIds, objet }),
      (c) => api.post<{ id: string }>(`/api/missions/${encodeURIComponent(missionId)}/factures`, c),
      {
        rafraichir: false,
        apres: (r) => router.push(`/facturation/${r.id}`),
        messageSpecifique: messageFacture,
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Création impossible"
      />
      <fieldset
        className={f.erreurs.elements ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
        aria-invalid={f.erreurs.elements ? true : undefined}
        aria-describedby={f.erreurs.elements ? "erreur-elements" : undefined}
      >
        <legend className="mp-champ__libelle">Éléments à facturer</legend>
        {echeances.map((e) => (
          <CaseACocher
            key={e.id}
            name="echeances"
            libelle={`${e.libelle} — ${formaterMontantMineur(e.montant, e.devise)}`}
            aide={`Échéance prévue le ${formaterDate(e.date_prevue)}`}
            checked={echeanceIds.includes(e.id)}
            onChange={(ev) => setEcheanceIds((l) => basculer(l, e.id, ev.target.checked))}
          />
        ))}
        {debours.map((d) => (
          <CaseACocher
            key={d.id}
            name="debours"
            libelle={`Débours — ${d.libelle} — ${formaterMontantMineur(d.montant, d.devise)}`}
            aide={`${CATEGORIE_LIBELLES[d.categorie]}, ${formaterDate(d.date)}, ${d.collaborateur_nom}`}
            checked={deboursIds.includes(d.id)}
            onChange={(ev) => setDeboursIds((l) => basculer(l, d.id, ev.target.checked))}
          />
        ))}
        {f.erreurs.elements ? (
          <p className="mp-champ__erreur" id="erreur-elements">
            {f.erreurs.elements}
          </p>
        ) : null}
      </fieldset>
      <Champ
        libelle="Objet de la facture"
        aide={`Facultatif. Devise : ${devise}.`}
        maxLength={300}
        value={objet}
        onChange={(e) => setObjet(e.target.value)}
        erreur={f.erreurs.objet}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="facture"
          chargement={f.enCours}
          texteChargement="Création du brouillon…"
        >
          Créer le brouillon de facture
        </Bouton>
      </div>
    </form>
  );
}
