"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select } from "../../../components/ui/Select";
import { ZoneTexte } from "../../../components/ui/ZoneTexte";
import { api } from "../../../lib/api";
import { PAYS } from "../../../lib/cabinet";
import {
  OPTIONS_TAILLES,
  SAISIE_CLIENT_VIDE,
  saisieDepuisClient,
  validerClient,
  type ChampClient,
  type Client,
  type SaisieClient,
} from "../../../lib/clients";

const OPTIONS_PAYS = PAYS.map((p) => ({ valeur: p.code, libelle: p.nom }));

/** Création (sans `client`) ou modification d'une fiche client. */
export function FormulaireClient({ client }: { client?: Client }) {
  const router = useRouter();
  const [saisie, setSaisie] = useState<SaisieClient>(() =>
    client ? saisieDepuisClient(client) : SAISIE_CLIENT_VIDE,
  );
  const f = useFormulaire<ChampClient>();
  const maj = (k: ChampClient) => (e: { target: { value: string } }) =>
    setSaisie((s) => ({ ...s, [k]: e.target.value }));
  const retour = client ? `/clients/${client.id}` : "/clients";

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerClient(saisie),
      (charge) =>
        client
          ? api.patch<Client>(`/api/clients/${encodeURIComponent(client.id)}`, charge)
          : api.post<Client>("/api/clients", charge),
      { rafraichir: false, apres: (c) => router.push(`/clients/${c.id}`) },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Identité légale</legend>
        <div className="mp-grille-champs">
          <Champ
            libelle="Raison sociale"
            name="raison_sociale"
            required
            maxLength={200}
            value={saisie.raison_sociale}
            onChange={maj("raison_sociale")}
            erreur={f.erreurs.raison_sociale}
          />
          <Champ
            libelle="Forme juridique"
            name="forme_juridique"
            maxLength={60}
            value={saisie.forme_juridique}
            onChange={maj("forme_juridique")}
            erreur={f.erreurs.forme_juridique}
            aide="Ex. SA, SARL, SAS, GIE."
          />
          <Champ
            libelle="Numéro RCCM"
            name="rccm"
            maxLength={60}
            value={saisie.rccm}
            onChange={maj("rccm")}
            erreur={f.erreurs.rccm}
            aide="Registre du commerce et du crédit mobilier, ex. CI-ABJ-2015-B-12345."
            autoCapitalize="characters"
            spellCheck={false}
          />
          <Champ
            libelle="Compte contribuable"
            name="compte_contribuable"
            maxLength={60}
            value={saisie.compte_contribuable}
            onChange={maj("compte_contribuable")}
            erreur={f.erreurs.compte_contribuable}
            aide="Numéro d'identification fiscale (NCC, NINEA, IFU…)."
            spellCheck={false}
          />
        </div>
      </fieldset>
      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Profil</legend>
        <div className="mp-grille-champs">
          <Champ
            libelle="Secteur d'activité"
            name="secteur"
            maxLength={120}
            value={saisie.secteur}
            onChange={maj("secteur")}
            erreur={f.erreurs.secteur}
            aide="Ex. Agro-industrie, Banque, Télécommunications."
          />
          <Select
            libelle="Pays"
            name="pays"
            required
            options={
              OPTIONS_PAYS.some((o) => o.valeur === saisie.pays)
                ? OPTIONS_PAYS
                : [{ valeur: saisie.pays, libelle: saisie.pays }, ...OPTIONS_PAYS]
            }
            value={saisie.pays}
            onChange={maj("pays")}
            erreur={f.erreurs.pays}
          />
          <Select
            libelle="Taille"
            name="taille"
            invite="Non renseignée"
            options={OPTIONS_TAILLES}
            value={saisie.taille}
            onChange={maj("taille")}
            erreur={f.erreurs.taille}
          />
        </div>
        <ZoneTexte
          libelle="Adresse"
          name="adresse"
          maxLength={500}
          value={saisie.adresse}
          onChange={maj("adresse")}
          erreur={f.erreurs.adresse}
        />
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {client ? "Enregistrer les modifications" : "Créer le client"}
        </Bouton>
        <Link href={retour} className={classesBouton("discret")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
