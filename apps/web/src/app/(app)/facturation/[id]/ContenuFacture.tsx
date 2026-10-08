"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFermetureDifferee } from "../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { api } from "../../../../lib/api";
import {
  messageFacture,
  validerLigne,
  type ChampLigne,
  type FactureDetaillee,
  type LigneFacture,
  type SaisieLigne,
  type TypeRemise,
} from "../../../../lib/factures";
import { formaterMontantMineur, formaterNombre, type Devise } from "../../../../lib/format";
import { montantVersSaisie } from "../../../../lib/saisie";

const NBSP = " ";
const pct = (n: number) => formaterNombre(n, 4) + NBSP + "%";

function libelleRemise(type: TypeRemise | null, valeur: number | null, devise: Devise): string {
  if (type === null || valeur === null) return "—";
  return type === "pourcentage" ? pct(valeur) : formaterMontantMineur(valeur, devise);
}

/** Lignes de la facture ; montants fournis par l'API, modifiables en brouillon (libellé, TVA, remise). */
export function LignesFacture({
  facture: f,
  modifiable,
  tauxAutorises,
}: {
  facture: FactureDetaillee;
  modifiable: boolean;
  tauxAutorises: readonly number[];
}) {
  const [edition, setEdition, fermerApresRafraichissement] = useFermetureDifferee<string>(
    f.modifie_le,
  );
  const m = (v: number) => formaterMontantMineur(v, f.devise);
  const ligne = f.lignes.find((l) => l.id === edition);
  return (
    <div className="mp-pile">
      <Tableau
        legende={f.nature === "avoir" ? "Lignes de l'avoir" : "Lignes de la facture"}
        lignes={f.lignes}
        cleLigne={(l) => l.id}
        messageVide="Aucune ligne."
        colonnes={[
          { cle: "libelle", entete: "Désignation", rendu: (l) => l.libelle },
          {
            cle: "quantite",
            entete: "Quantité",
            alignement: "droite",
            rendu: (l) => formaterNombre(l.quantite, 4),
          },
          {
            cle: "prix",
            entete: "Prix unitaire HT",
            alignement: "droite",
            rendu: (l) => m(l.prix_unitaire),
          },
          {
            cle: "remise",
            entete: "Remise",
            alignement: "droite",
            rendu: (l) => libelleRemise(l.remise_type, l.remise_valeur, f.devise),
          },
          { cle: "tva", entete: "TVA", alignement: "droite", rendu: (l) => pct(l.taux_tva) },
          {
            cle: "ht",
            entete: "Montant HT",
            alignement: "droite",
            rendu: (l) => <span className="mp-montant">{m(l.montant_ht)}</span>,
          },
          ...(modifiable
            ? [
                {
                  cle: "actions",
                  entete: "Actions",
                  rendu: (l: LigneFacture) => (
                    <Bouton
                      variante="discret"
                      icone="crayon"
                      onClick={() => setEdition(l.id)}
                      aria-label={`Modifier la ligne ${l.libelle}`}
                    >
                      Modifier
                    </Bouton>
                  ),
                },
              ]
            : []),
        ]}
      />
      {modifiable && ligne ? (
        <FormulaireLigne
          key={ligne.id}
          factureId={f.id}
          ligne={ligne}
          devise={f.devise}
          tauxAutorises={tauxAutorises}
          onFin={() => setEdition(null)}
          onEnregistre={fermerApresRafraichissement}
        />
      ) : null}
    </div>
  );
}

function FormulaireLigne({
  factureId,
  ligne,
  devise,
  tauxAutorises,
  onFin,
  onEnregistre,
}: {
  factureId: string;
  ligne: LigneFacture;
  devise: Devise;
  tauxAutorises: readonly number[];
  onFin: () => void;
  onEnregistre: () => void;
}) {
  const [s, setS] = useState<SaisieLigne>({
    libelle: ligne.libelle,
    taux_tva: String(ligne.taux_tva),
    remise: {
      type: ligne.remise_type ?? "",
      valeur:
        ligne.remise_valeur === null
          ? ""
          : ligne.remise_type === "montant"
            ? montantVersSaisie(ligne.remise_valeur, devise)
            : String(ligne.remise_valeur).replace(".", ","),
    },
  });
  const f = useFormulaire<ChampLigne>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerLigne(s, devise, tauxAutorises),
      (c) =>
        api.patch(
          `/api/factures/${encodeURIComponent(factureId)}/lignes/${encodeURIComponent(ligne.id)}`,
          c,
        ),
      { apres: onEnregistre, messageSpecifique: messageFacture },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Modifier la ligne ${ligne.libelle}`}
    >
      <p className="mp-sous-formulaire__titre">{`Modifier la ligne « ${ligne.libelle} »`}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Désignation"
          required
          maxLength={300}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle="Taux de TVA"
          options={tauxAutorises.map((t) => ({ valeur: String(t), libelle: pct(t) }))}
          value={s.taux_tva}
          onChange={(e) => setS((x) => ({ ...x, taux_tva: e.target.value }))}
          erreur={f.erreurs.taux_tva}
        />
        <ChampsRemise
          saisie={s.remise}
          devise={devise}
          erreur={f.erreurs.remise}
          onChange={(remise) => setS((x) => ({ ...x, remise }))}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Recalcul…">
          Enregistrer et recalculer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

/** Type et valeur d'une remise (aucune, pourcentage ou montant). */
export function ChampsRemise({
  saisie,
  devise,
  erreur,
  onChange,
  libelle = "Remise",
}: {
  saisie: SaisieLigne["remise"];
  devise: Devise;
  erreur?: string;
  onChange: (r: SaisieLigne["remise"]) => void;
  libelle?: string;
}) {
  return (
    <>
      <Select
        libelle={libelle}
        options={[
          { valeur: "", libelle: "Aucune" },
          { valeur: "pourcentage", libelle: "En pourcentage" },
          { valeur: "montant", libelle: `En montant (${devise})` },
        ]}
        value={saisie.type}
        onChange={(e) => {
          const t = e.target.value;
          onChange({
            type: t === "pourcentage" || t === "montant" ? t : "",
            valeur: t ? saisie.valeur : "",
          });
        }}
      />
      {saisie.type ? (
        <Champ
          libelle={saisie.type === "pourcentage" ? `${libelle} (%)` : `${libelle} (${devise})`}
          required
          inputMode="decimal"
          value={saisie.valeur}
          onChange={(e) => onChange({ ...saisie, valeur: e.target.value })}
          erreur={erreur}
        />
      ) : null}
    </>
  );
}

/** Totaux calculés par le serveur (moteur) : aucune opération sur un montant ici. */
export function TotauxFacture({ facture: f }: { facture: FactureDetaillee }) {
  const m = (v: number) => formaterMontantMineur(v, f.devise);
  return (
    <dl className="mp-totaux-facture">
      <div>
        <dt>Total brut HT</dt>
        <dd>{m(f.total_brut)}</dd>
      </div>
      {f.total_remises !== 0 ? (
        <div>
          <dt>
            Remises
            {f.remise_globale_type
              ? ` (dont globale : ${libelleRemise(f.remise_globale_type, f.remise_globale_valeur, f.devise)})`
              : ""}
          </dt>
          <dd>{m(f.total_remises)}</dd>
        </div>
      ) : null}
      <div>
        <dt>Total HT</dt>
        <dd>{m(f.total_ht)}</dd>
      </div>
      {(f.tva ?? []).map((t) => (
        <div key={t.taux}>
          <dt>{`TVA ${pct(t.taux)} sur ${m(t.base)}`}</dt>
          <dd>{m(t.montant)}</dd>
        </div>
      ))}
      <div>
        <dt>Total TVA</dt>
        <dd>{m(f.total_tva)}</dd>
      </div>
      <div className="mp-totaux-facture__fort">
        <dt>Total TTC</dt>
        <dd>{m(f.total_ttc)}</dd>
      </div>
      {(f.retenues ?? []).map((r) => (
        <div key={r.libelle}>
          <dt>{`${r.libelle} (${pct(r.taux)} sur ${r.base} : ${m(r.assiette)})`}</dt>
          <dd>{m(r.montant)}</dd>
        </div>
      ))}
      <div className="mp-totaux-facture__net">
        <dt>Net à payer</dt>
        <dd>{m(f.net_a_payer)}</dd>
      </div>
    </dl>
  );
}
